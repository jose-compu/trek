/**
 * Decision/Scripts route. Mechanical replace with no chat model.
 */

import { withFileMutationQueue } from "./tools/file-mutation-queue.ts";
import { resolveToCwd } from "./tools/path-utils.ts";
import { pickScriptEngine, runScriptEdit, type ScriptEditOptions } from "./tools/script-edit.ts";
import { probeUnixTools } from "./tools/unix-tools.ts";

export interface ReplaceIntent {
	kind: "replace";
	from: string;
	to: string;
	path: string;
}

export type ScriptsIntent = ReplaceIntent;

const REPLACE = /^replace\s+(.+?)\s+with\s+(.+?)\s+in\s+(\S+)\s*$/i;

export function parseScriptsIntent(task: string): ScriptsIntent | undefined {
	const match = REPLACE.exec(task.trim());
	if (!match) {
		return undefined;
	}
	const from = match[1]?.trim() ?? "";
	const to = match[2]?.trim() ?? "";
	const path = match[3]?.trim() ?? "";
	if (!from || !to || !path) {
		return undefined;
	}
	return { kind: "replace", from, to, path };
}

function escapePattern(value: string): string {
	return value.replace(/[/\\.*^$[\]~]/g, "\\$&");
}

function escapeReplacement(value: string): string {
	return value.replace(/[/\\&]/g, "\\$&");
}

export function replaceScript(from: string, to: string, engine: "ex" | "sed" = "ex"): string {
	const escapedFrom = escapePattern(from);
	const escapedTo = escapeReplacement(to);
	if (engine === "sed") {
		return `s/${escapedFrom}/${escapedTo}/g`;
	}
	return `%s/${escapedFrom}/${escapedTo}/g\nwq\n`;
}

export async function runScriptsIntent(
	cwd: string,
	intent: ScriptsIntent,
	options: { runEdit?: typeof runScriptEdit; dryRun?: ScriptEditOptions["dryRun"] } = {},
): Promise<string> {
	const edit = options.runEdit ?? runScriptEdit;
	if (intent.kind === "replace") {
		const engine = pickScriptEngine("auto", probeUnixTools());
		const result = await withFileMutationQueue(resolveToCwd(intent.path, cwd), () =>
			edit(
				cwd,
				{
					path: intent.path,
					script: replaceScript(intent.from, intent.to, engine === "sed" ? "sed" : "ex"),
					engine: engine ?? "auto",
				},
				{ dryRun: options.dryRun },
			),
		);
		const status = result.dryRun ? "dry-run" : "ok";
		return `script_edit ${result.engine} ${intent.path}  +${result.added} -${result.removed}  ${status}`;
	}
	throw new Error("unknown scripts intent");
}
