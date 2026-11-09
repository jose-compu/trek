/**
 * script_edit — in-place Unix editors (ex / vim -Es / ed / sed). No TTY.
 * Snapshot first. Auto tries ex, then vim, then ed, then sed (D27).
 */

import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AgentTool } from "@trek/agent-core";
import { Text } from "@trek/tui";
import { type Static, Type } from "typebox";
import { cardGlyph } from "../../modes/interactive/components/card-glyph.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";
import { getShellEnv, killProcessTree } from "../../utils/shell.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { TrekVersionStore } from "../trek-store/index.ts";
import { generateUnifiedPatch } from "./edit-diff.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { probeUnixTools, type SedFlavor, type UnixToolId, type UnixToolReport } from "./unix-tools.ts";

export const SCRIPT_ENGINES = ["ex", "vim", "ed", "sed"] as const;
export type ScriptEngine = (typeof SCRIPT_ENGINES)[number];
export type ScriptEngineChoice = "auto" | ScriptEngine;

export const DEFAULT_SCRIPT_EDIT_TIMEOUT_MS = 8_000;

const scriptEditSchema = Type.Object({
	path: Type.String({ description: "File to edit in place" }),
	script: Type.String({
		description: "ex/ed here-doc, or a sed program. For ex/vim/ed include wq. No TUI.",
	}),
	engine: Type.Optional(
		Type.Unsafe<"auto" | ScriptEngine>({
			description: "auto (ex, then vim -Es, then ed, then sed), or a named engine",
		}),
	),
	dry_run: Type.Optional(Type.Boolean({ description: "Print the script and a unified diff. Do not write." })),
	timeout: Type.Optional(Type.Number({ description: "Kill the editor after this many seconds. Default 8." })),
});

export type ScriptEditToolInput = Static<typeof scriptEditSchema>;

export interface ScriptEditToolDetails {
	engine: ScriptEngine;
	path: string;
	script: string;
	diff: string;
	added: number;
	removed: number;
	dryRun?: boolean;
	killed?: boolean;
}

export interface ScriptEditOptions {
	timeoutMs?: number;
	probe?: UnixToolReport;
	store?: TrekVersionStore;
	promptNumber?: number;
	promptId?: string;
	dryRun?: () => boolean;
}

export interface RunScriptEditResult {
	engine: ScriptEngine;
	path: string;
	script: string;
	before: string;
	after: string;
	diff: string;
	added: number;
	removed: number;
	stdout: string;
	stderr: string;
	killed: boolean;
	dryRun: boolean;
}

export function pickScriptEngine(requested: ScriptEngineChoice, report: UnixToolReport): ScriptEngine | undefined {
	const present = (id: UnixToolId) => report.tools.some((tool) => tool.id === id && tool.present);
	if (requested !== "auto") {
		return present(requested) ? requested : undefined;
	}
	for (const engine of SCRIPT_ENGINES) {
		if (present(engine)) {
			return engine;
		}
	}
	return undefined;
}

export function sedFlavorOf(report: UnixToolReport): SedFlavor {
	return report.tools.find((tool) => tool.id === "sed")?.flavor ?? "unknown";
}

export function binaryFor(engine: ScriptEngine, report: UnixToolReport): string {
	return report.tools.find((tool) => tool.id === engine)?.path ?? engine;
}

export function patchStats(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
			continue;
		}
		if (line.startsWith("+")) {
			added += 1;
		} else if (line.startsWith("-")) {
			removed += 1;
		}
	}
	return { added, removed };
}

function firstScriptLine(script: string): string {
	return script.split(/\r?\n/).find((line) => line.trim().length > 0) ?? script;
}

export function formatScriptEditCard(input: {
	engine: string;
	path: string;
	script: string;
	status: string;
	added?: number;
	removed?: number;
	expanded?: boolean;
	diff?: string;
}): string {
	const stats = input.added !== undefined && input.removed !== undefined ? `  +${input.added} -${input.removed}` : "";
	const header = `${cardGlyph("script_edit")} script_edit  ${input.engine}  ${input.path}${stats}  ${input.status}`;
	if (!input.expanded) {
		const line = firstScriptLine(input.script);
		return line ? `${header}\n${line}` : header;
	}
	const parts = [header, input.script.trimEnd()];
	if (input.diff) {
		parts.push(input.diff.trimEnd());
	}
	return parts.join("\n");
}

interface SpawnSpec {
	bin: string;
	args: string[];
	stdin?: string;
}

function sedArgs(flavor: SedFlavor, scriptFile: string, file: string): string[] {
	if (flavor === "gnu") {
		return ["-i", "-f", scriptFile, file];
	}
	return ["-i", "", "-f", scriptFile, file];
}

function engineSpec(
	engine: ScriptEngine,
	bin: string,
	file: string,
	script: string,
	scriptFile: string | undefined,
	flavor: SedFlavor,
): SpawnSpec {
	if (engine === "ex") {
		return { bin, args: ["-s", file], stdin: script };
	}
	if (engine === "vim") {
		return { bin, args: ["-Es", "-u", "NONE", "-i", "NONE", "-N", file], stdin: script };
	}
	if (engine === "ed") {
		return { bin, args: ["-s", file], stdin: script };
	}
	return { bin, args: sedArgs(flavor, scriptFile ?? "", file) };
}

async function spawnEditor(
	spec: SpawnSpec,
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{
	stdout: string;
	stderr: string;
	killed: boolean;
	exitCode: number | null;
}> {
	const child = spawnProcess(spec.bin, spec.args, {
		cwd,
		detached: process.platform !== "win32",
		env: getShellEnv(),
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	if (spec.stdin !== undefined) {
		child.stdin?.write(spec.stdin.endsWith("\n") ? spec.stdin : `${spec.stdin}\n`);
	}
	child.stdin?.end();

	let timedOut = false;
	const onAbort = () => {
		if (child.pid) {
			killProcessTree(child.pid);
		}
	};
	const timer = setTimeout(() => {
		timedOut = true;
		onAbort();
	}, timeoutMs);
	if (signal) {
		if (signal.aborted) {
			onAbort();
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}
	}
	try {
		const exitCode = await waitForChildProcess(child);
		return { stdout, stderr, killed: timedOut || Boolean(signal?.aborted), exitCode };
	} finally {
		clearTimeout(timer);
		if (signal) {
			signal.removeEventListener("abort", onAbort);
		}
	}
}

async function snapshotBefore(absPath: string, before: string, options: ScriptEditOptions): Promise<void> {
	const store = options.store;
	if (!store) {
		return;
	}
	const rel = store.toRelPath(absPath);
	if (!rel) {
		return;
	}
	await store.record({
		promptNumber: options.promptNumber ?? 1,
		promptId: options.promptId ?? "script_edit",
		relPath: rel,
		kind: "edit",
		before: { kind: "content", content: before },
		after: before,
	});
}

export async function runScriptEdit(
	cwd: string,
	input: ScriptEditToolInput,
	options: ScriptEditOptions = {},
	signal?: AbortSignal,
): Promise<RunScriptEditResult> {
	const absPath = resolveToCwd(input.path, cwd);
	const before = await readFile(absPath, "utf8");
	const report = options.probe ?? probeUnixTools();
	const requested = input.engine ?? "auto";
	const engine = pickScriptEngine(requested, report);
	if (!engine) {
		throw new Error(
			requested === "auto" ? "No in-place editor on PATH (ex, vim, ed, sed)." : `${requested} is not on PATH.`,
		);
	}
	const timeoutMs =
		typeof input.timeout === "number" && input.timeout > 0
			? Math.round(input.timeout * 1000)
			: (options.timeoutMs ?? DEFAULT_SCRIPT_EDIT_TIMEOUT_MS);
	const dryRun = input.dry_run === true || options.dryRun?.() === true;
	const workDir = await mkdtemp(join(tmpdir(), "trek-script-edit-"));
	try {
		const target = dryRun ? join(workDir, basename(absPath)) : absPath;
		if (dryRun) {
			await copyFile(absPath, target);
		} else {
			await snapshotBefore(absPath, before, options);
		}
		const scriptFile = join(workDir, "script");
		await writeFile(scriptFile, input.script.endsWith("\n") ? input.script : `${input.script}\n`);
		const spec = engineSpec(engine, binaryFor(engine, report), target, input.script, scriptFile, sedFlavorOf(report));
		const spawned = await spawnEditor(spec, cwd, timeoutMs, signal);
		if (spawned.killed) {
			throw new Error(`script_edit timed out after ${timeoutMs}ms (${engine})`);
		}
		if (spawned.exitCode !== 0 && spawned.exitCode !== null) {
			const err = spawned.stderr.trim() || spawned.stdout.trim() || `exit ${spawned.exitCode}`;
			throw new Error(`script_edit ${engine} failed: ${err}`);
		}
		const after = await readFile(target, "utf8");
		const diff = generateUnifiedPatch(input.path, before, after);
		const stats = patchStats(diff);
		return {
			engine,
			path: absPath,
			script: input.script,
			before,
			after,
			diff,
			added: stats.added,
			removed: stats.removed,
			stdout: spawned.stdout,
			stderr: spawned.stderr,
			killed: spawned.killed,
			dryRun,
		};
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

function formatCall(args: Partial<ScriptEditToolInput> | undefined, expanded: boolean): string {
	const path = str(args?.path) ?? "";
	const script = str(args?.script) ?? "";
	const engine = str(args?.engine) || "auto";
	return formatScriptEditCard({
		engine,
		path: shortenPath(path) || path,
		script,
		status: args?.dry_run ? "dry-run" : "…",
		expanded,
	});
}

function formatResult(details: ScriptEditToolDetails | undefined, expanded: boolean): string | undefined {
	if (!details) {
		return undefined;
	}
	return formatScriptEditCard({
		engine: details.engine,
		path: shortenPath(details.path) || details.path,
		script: details.script,
		status: details.dryRun ? "dry-run" : details.killed ? "killed" : "ok",
		added: details.added,
		removed: details.removed,
		expanded,
		diff: details.diff,
	});
}

export function createScriptEditToolDefinition(
	cwd: string,
	options?: ScriptEditOptions,
): ToolDefinition<typeof scriptEditSchema, ScriptEditToolDetails> {
	const isDryRun = options?.dryRun ?? (() => false);
	return {
		name: "script_edit",
		label: "script_edit",
		reversibilityTier: "cheap",
		description:
			"Edit a file in place with ex, vim -Es, ed, or sed. No TUI. Snapshots first. Prefer this to rewriting the whole file with write. engine=auto tries ex, then vim, then ed, then sed.",
		promptSnippet: "In-place Unix edit (ex / vim -Es / ed / sed). Snapshot first. No TUI.",
		promptGuidelines: [
			"Prefer script_edit over write for substitutions, deleting matching lines, and mechanical edits.",
			"Never call interactive vim, nano, emacs, or a pager.",
			"Snapshot is the Law 1 read. Do not read the file first.",
		],
		parameters: scriptEditSchema,
		async execute(_toolCallId, params, signal) {
			const dry = params.dry_run === true || isDryRun();
			const result = await withFileMutationQueue(resolveToCwd(params.path, cwd), () =>
				runScriptEdit(cwd, { ...params, dry_run: dry }, options, signal),
			);
			const details: ScriptEditToolDetails = {
				engine: result.engine,
				path: result.path,
				script: result.script,
				diff: result.diff,
				added: result.added,
				removed: result.removed,
				dryRun: result.dryRun,
				killed: result.killed,
			};
			const text = formatScriptEditCard({
				engine: result.engine,
				path: result.path,
				script: result.script,
				status: result.dryRun ? "dry-run" : "ok",
				added: result.added,
				removed: result.removed,
				expanded: true,
				diff: result.diff,
			});
			return { content: [{ type: "text", text }], details };
		},
		renderCall(args, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatCall(args, Boolean(context.expanded)));
			return text;
		},
		renderResult(result, options, _theme, context) {
			const details = (result as { details?: ScriptEditToolDetails }).details;
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const body = formatResult(details, Boolean(options.expanded)) ?? "";
			const extra =
				!options.expanded && details?.script.includes("\n") ? ` ${keyHint("app.tools.expand", "here-doc")}` : "";
			text.setText(body + extra);
			return text;
		},
	};
}

export function createScriptEditTool(cwd: string, options?: ScriptEditOptions): AgentTool<typeof scriptEditSchema> {
	return wrapToolDefinition(createScriptEditToolDefinition(cwd, options));
}
