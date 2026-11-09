/**
 * Decision/Scripts route. Mechanical replace with no chat model.
 */

import { replaceScript, type ScriptsIntent } from "./scripts-intent.ts";
import { withFileMutationQueue } from "./tools/file-mutation-queue.ts";
import { resolveToCwd } from "./tools/path-utils.ts";
import { pickScriptEngine, runScriptEdit, type ScriptEditOptions } from "./tools/script-edit.ts";
import { probeUnixTools } from "./tools/unix-tools.ts";

export { parseScriptsIntent, type ReplaceIntent, replaceScript, type ScriptsIntent } from "./scripts-intent.ts";

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
