import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool } from "@trek/agent-core";
import { Container, Text } from "@trek/tui";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { cardGlyph } from "../../modes/interactive/components/card-glyph.ts";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../modes/interactive/theme/theme.ts";
import { waitForChildProcess } from "../../utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "../../utils/shell.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { looksLikeLayeringControlEcho } from "../runtime/escalate.ts";
import {
	formatBackgroundedBash,
	isServerReadyOutput,
	looksLikeServerCommand,
	resolveBlockUntilMs,
	resolveTimeoutSeconds,
} from "./bash-background.ts";
import { bashRecipeSuggestion } from "./bash-recipes.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { formatScriptEditCard, runScriptEdit, type ScriptEditToolDetails } from "./script-edit.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";
import { inspectBashCommand } from "./unix-guards.ts";

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Timeout in seconds. Kills the process. Wait/poll commands (sleep, gh pr checks --watch, gh run watch) wait for exit up to this cap (default 300s) and are not backgrounded. Other commands cap at 120s. Optional.",
		}),
	),
	block_until_ms: Type.Optional(
		Type.Number({
			description:
				"Wait this many milliseconds then leave the process running and return. 0 waits for exit. An explicit timeout also waits for exit. Wait/poll commands wait for exit. Server-like commands (python -m http.server, vite, npm start, …) return after 1.5s and ignore timeout. Unlike timeout, the process is not killed.",
		}),
	),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	backgrounded?: boolean;
	pid?: number;
	scriptEdit?: ScriptEditToolDetails;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			blockUntilMs?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null; backgrounded?: boolean; pid?: number }>;
}

/**
 * Create bash operations using pi's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want pi's
 * standard local shell behavior while wrapping or rewriting commands.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function waitForExitOrBackground(
	exitPromise: Promise<{ kind: "exit"; exitCode: number | null }>,
	blockUntilMs: number,
	isReady: () => boolean,
): Promise<{ kind: "exit"; exitCode: number | null } | { kind: "block" }> {
	const deadline = Date.now() + blockUntilMs;
	while (true) {
		if (isReady()) {
			return { kind: "block" };
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return { kind: "block" };
		}
		const result = await Promise.race([
			exitPromise,
			sleep(Math.min(200, remaining)).then(() => ({ kind: "poll" as const })),
		]);
		if (result.kind === "exit") {
			return result;
		}
	}
}

export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, blockUntilMs, env }) => {
			const { shell, args } = getShellConfig(options?.shellPath);
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}
			if (signal?.aborted) {
				throw new Error("aborted");
			}

			const child = spawn(shell, [...args, command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (child.pid) trackDetachedChildPid(child.pid);
			let timedOut = false;
			let backgrounded = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				// Set timeout if provided.
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}
				let ready = false;
				const onChunk = (data: Buffer): void => {
					onData(data);
					if (!ready && isServerReadyOutput(data.toString("utf8"))) {
						ready = true;
					}
				};
				// Stream stdout and stderr.
				child.stdout?.on("data", onChunk);
				child.stderr?.on("data", onChunk);
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				const exitPromise = waitForChildProcess(child).then((exitCode) => ({
					kind: "exit" as const,
					exitCode,
				}));
				void exitPromise.catch(() => {});
				let settled: { kind: "exit"; exitCode: number | null };
				if (blockUntilMs !== undefined && blockUntilMs > 0) {
					const blocked = await waitForExitOrBackground(exitPromise, blockUntilMs, () => ready);
					if (blocked.kind === "block") {
						backgrounded = true;
						const drain = (): void => {};
						child.stdout?.removeListener("data", onChunk);
						child.stderr?.removeListener("data", onChunk);
						child.stdout?.on("data", drain);
						child.stderr?.on("data", drain);
						child.unref();
						return { exitCode: null, backgrounded: true, pid: child.pid };
					}
					settled = blocked;
				} else {
					settled = await exitPromise;
				}
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}
				return { exitCode: settled.exitCode, pid: child.pid };
			} finally {
				if (!backgrounded && child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/** When this returns true, do NOT execute; report the command that would run (SPECS_SAFETY_HARNESS §6). */
	dryRun?: () => boolean;
}

const BASH_PREVIEW_LINES = 3;
const DIAGNOSTIC_LINE = /^\s*error:\s+\S+:\d+:\d+:/;

/** Located compiler errors, such as `error: File.lean:19:0: ...`. Generic build lines are omitted. */
export function compilerDiagnosticLines(output: string): string[] {
	const found = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => DIAGNOSTIC_LINE.test(line));
	return [...new Set(found)].slice(0, 12);
}

/** Collapsed bash view for a failed build: the diagnostics, not the trailing exit line. */
export function bashCollapsedText(output: string): string | undefined {
	const found = compilerDiagnosticLines(output);
	if (found.length === 0) {
		return undefined;
	}
	const shown = found.slice(0, 8);
	const extra = found.length - shown.length;
	const status = [...output.split("\n")].reverse().find((line) => /^Command exited with code \d+/.test(line.trim()));
	const parts = [...shown];
	if (extra > 0) {
		parts.push(`... ${extra} more error lines`);
	}
	if (status) {
		parts.push(status.trim());
	}
	return parts.join("\n");
}
const BASH_UPDATE_THROTTLE_MS = 100;

type BashRenderState = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	interval: NodeJS.Timeout | undefined;
};

type BashResultRenderState = {
	cachedWidth: number | undefined;
	cachedLines: string[] | undefined;
	cachedSkipped: number | undefined;
};

class BashResultRenderComponent extends Container {
	state: BashResultRenderState = {
		cachedWidth: undefined,
		cachedLines: undefined,
		cachedSkipped: undefined,
	};
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function firstCommandLine(command: string): string {
	return command.split(/\r?\n/).find((line) => line.length > 0) ?? command;
}

function formatBashCall(args: { command?: string; timeout?: number } | undefined, compact = false): string {
	const command = str(args?.command);
	if (command) {
		const guard = inspectBashCommand(command);
		if (guard.action === "script_edit") {
			return formatScriptEditCard({
				engine: guard.edit.engine,
				path: guard.edit.path,
				script: guard.edit.script,
				status: "…",
			});
		}
	}
	const timeout = args?.timeout as number | undefined;
	const shownTimeout =
		command && looksLikeServerCommand(command) ? undefined : resolveTimeoutSeconds(command ?? "", timeout);
	const timeoutSuffix = shownTimeout ? theme.fg("muted", ` (timeout ${shownTimeout}s)`) : "";
	let commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
	if (compact && command) {
		commandDisplay = firstCommandLine(command);
	}
	return theme.fg("toolTitle", theme.bold(`${cardGlyph("bash")} $ ${commandDisplay}`)) + timeoutSuffix;
}

function rebuildBashResultRenderComponent(
	component: BashResultRenderComponent,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	const state = component.state;
	component.clear();

	let output = getTextOutput(result as any, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			component.addChild(new Text(`\n${styledOutput}`, 0, 0));
		} else {
			component.addChild({
				render: (width: number) => {
					if (state.cachedLines === undefined || state.cachedWidth !== width) {
						const collapsed = bashCollapsedText(output);
						const previewSource = collapsed
							? collapsed
									.split("\n")
									.map((line) => theme.fg("toolOutput", line))
									.join("\n")
							: styledOutput;
						const preview = truncateToVisualLines(
							previewSource,
							collapsed ? Math.max(BASH_PREVIEW_LINES, collapsed.split("\n").length) : BASH_PREVIEW_LINES,
							width,
						);
						state.cachedLines = preview.visualLines;
						state.cachedSkipped = collapsed
							? Math.max(output.split("\n").length - collapsed.split("\n").length, 0)
							: preview.skippedCount;
						state.cachedWidth = width;
					}
					return [...(state.cachedLines ?? [])];
				},
				invalidate: () => {
					state.cachedWidth = undefined;
					state.cachedLines = undefined;
					state.cachedSkipped = undefined;
				},
			});
		}
	}

	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
	}

	if (options.expanded && startedAt !== undefined) {
		const label = options.isPartial ? "Elapsed" : "Took";
		const endTime = endedAt ?? Date.now();
		component.addChild(new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0));
	}
}

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined, BashRenderState> {
	const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const isDryRun = options?.dryRun ?? (() => false);
	return {
		name: "bash",
		label: "bash",
		reversibilityTier: "gated",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. A still-running command returns after 8s and keeps running unless it is a wait/poll (sleep, gh pr checks --watch, gh run watch) or timeout is set — those wait for exit until timeout kills them. Server-like commands (python -m http.server, vite, npm start) return after 1.5s, ignore timeout, and ignore block_until_ms: 0. They also return as soon as they print a listen/bind line. Prefer gh --watch over sleep loops. Recipes: ${bashRecipeSuggestion()}.`,
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		parameters: bashSchema,
		async execute(
			_toolCallId,
			{ command, timeout, block_until_ms }: { command: string; timeout?: number; block_until_ms?: number },
			signal?: AbortSignal,
			onUpdate?,
			_ctx?,
		) {
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const guard = inspectBashCommand(resolvedCommand);
			if (guard.action === "refuse") {
				throw new Error(guard.reason);
			}
			if (guard.action === "script_edit" && !isDryRun()) {
				try {
					const result = await runScriptEdit(cwd, {
						path: guard.edit.path,
						script: guard.edit.script,
						engine: guard.edit.engine,
					});
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
					return { content: [{ type: "text", text }], details: { scriptEdit: details } };
				} catch {
					// Mixed or unparsable in-place edit stays on bash. No error card.
				}
			}
			const guardedCommand = guard.action === "rewrite" ? guard.command : resolvedCommand;

			if (looksLikeLayeringControlEcho(command) || looksLikeLayeringControlEcho(guardedCommand)) {
				return { content: [{ type: "text", text: "" }], details: undefined };
			}

			// Dry-run: do not execute; report the command that would run.
			if (isDryRun()) {
				return {
					content: [{ type: "text", text: `[dry-run] would execute:\n${guardedCommand}` }],
					details: undefined,
				};
			}

			const spawnContext = resolveSpawnContext(guardedCommand, cwd, spawnHook);
			const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}

			const handleData = (data: Buffer) => {
				output.append(data);
				scheduleOutputUpdate();
			};

			const finishOutput = async () => {
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
					} else {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
					}
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				let exitCode: number | null;
				let backgrounded = false;
				let backgroundPid: number | undefined;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						signal,
						timeout: resolveTimeoutSeconds(command, timeout),
						blockUntilMs: resolveBlockUntilMs(command, block_until_ms, timeout),
						env: spawnContext.env,
					});
					exitCode = result.exitCode;
					backgrounded = result.backgrounded === true;
					backgroundPid = result.pid;
				} catch (err) {
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const timeoutSecs = err.message.split(":")[1];
						throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
					}
					throw err;
				}

				const snapshot = await finishOutput();
				const { text: outputText, details } = formatOutput(snapshot);
				if (backgrounded && backgroundPid !== undefined) {
					return {
						content: [
							{
								type: "text",
								text: formatBackgroundedBash(backgroundPid, outputText === "(no output)" ? "" : outputText),
							},
						],
						details: { ...details, backgrounded: true, pid: backgroundPid },
					};
				}
				if (exitCode !== 0 && exitCode !== null) {
					const diagnostics = compilerDiagnosticLines(outputText);
					const lead = diagnostics.length > 0 ? `${diagnostics.join("\n")}\n\n` : "";
					throw new Error(lead + appendStatus(outputText, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text: outputText }], details };
			} finally {
				clearUpdateTimer();
			}
		},
		renderCall(args, _theme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			if (looksLikeLayeringControlEcho(typeof args.command === "string" ? args.command : "")) {
				text.setText("");
				return text;
			}
			text.setText(formatBashCall(args, !context.expanded));
			return text;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}
			const component =
				(context.lastComponent as BashResultRenderComponent | undefined) ?? new BashResultRenderComponent();
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
			);
			component.invalidate();
			return component;
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}
