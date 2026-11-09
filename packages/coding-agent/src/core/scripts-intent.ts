/**
 * Parse-only Scripts intent. Keep this file free of editor/PATH imports so
 * every turn can reject a non-match without delaying streaming.
 */

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
