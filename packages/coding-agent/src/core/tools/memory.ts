import { Text } from "@trek/tui";
import { Type } from "typebox";
import type { Theme, ThemeColor } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { MemoryLayer, MemoryManager } from "../memory/manager.ts";
import { getTextOutput } from "./render-utils.ts";

const LAYER_COLOR: Record<string, ThemeColor> = {
	project: "success",
	session: "accent",
	global: "warning",
};

const KIND_COLOR: Record<string, ThemeColor> = {
	lesson: "syntaxKeyword",
	file: "mdLink",
	thinking: "thinkingMedium",
	turn: "syntaxType",
	handoff: "syntaxFunction",
	note: "muted",
};

const CITATION_COLOR: Record<string, ThemeColor> = {
	kind: "syntaxKeyword",
	tag: "syntaxString",
	file: "mdLink",
	lines: "syntaxNumber",
	offset: "syntaxNumber",
};

const HIT_START = /^\[(session|project|global) (lesson|file|turn|thinking|handoff|note)\]\s*/;

/** Display-only colors. The text stored for the model stays plain. */
export function formatRecallDisplay(raw: string, theme: Theme): string {
	if (raw === "no results") return theme.fg("muted", raw);
	if (raw.startsWith("search failed")) return theme.fg("error", raw);
	return raw
		.split("\n")
		.map((line) => colorRecallLine(line, theme))
		.join("\n");
}

function colorRecallLine(line: string, theme: Theme): string {
	const match = HIT_START.exec(line);
	if (!match) return theme.fg("toolOutput", line);
	const layer = match[1] ?? "";
	const kind = match[2] ?? "";
	const head =
		theme.fg("dim", "[") +
		theme.fg(LAYER_COLOR[layer] ?? "text", layer) +
		theme.fg("dim", " ") +
		theme.fg(KIND_COLOR[kind] ?? "text", kind) +
		theme.fg("dim", "]");
	const rest = line.slice(match[0].length);
	return rest ? `${head} ${colorCitation(rest, theme)}` : head;
}

function colorCitation(text: string, theme: Theme): string {
	return text.replace(/\[([a-z]+):([^\]]*)\]/g, (token, key: string, value: string) => {
		const known = CITATION_COLOR[key];
		if (!known) return theme.fg("toolOutput", token);
		const valueColor = key === "kind" ? (KIND_COLOR[value] ?? known) : known;
		return (
			theme.fg("dim", "[") +
			theme.fg("muted", key) +
			theme.fg("dim", ":") +
			theme.fg(valueColor, value) +
			theme.fg("dim", "]")
		);
	});
}

const rememberSchema = Type.Object({
	text: Type.String({ description: "Project lesson to keep for later sessions in this repo" }),
	tag: Type.Optional(Type.String({ description: "Optional lesson tag, for example billing" })),
});

const recallSchema = Type.Object({
	query: Type.String({ description: "What to search for in local memory" }),
	layer: Type.Optional(Type.String({ description: "session, project, or global. Default: every enabled layer" })),
});

const forgetSchema = Type.Object({
	query: Type.String({ description: "Description of the memory to remove" }),
	layer: Type.String({ description: "session, project, or global" }),
});

function asLayer(value: string | undefined): MemoryLayer | undefined {
	if (value === "session" || value === "project" || value === "global") return value;
	return undefined;
}

export function createMemoryToolDefinitions(getMemory: () => MemoryManager): ToolDefinition[] {
	const remember: ToolDefinition = {
		name: "remember",
		label: "remember",
		description: "Store a project lesson in local memory. Later sessions in this repo can recall it.",
		promptSnippet: "Store a project lesson",
		parameters: rememberSchema,
		execute: async (_id, params) => {
			const text = String((params as { text?: string }).text ?? "");
			const tag = (params as { tag?: string }).tag;
			try {
				const result = await getMemory().remember(text, tag);
				return { content: [{ type: "text", text: result }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `store failed: ${String(error)}` }], details: undefined };
			}
		},
	};
	const recall: ToolDefinition = {
		name: "recall",
		label: "recall",
		description: "Search local memory. Returns the closest lessons, files, and session notes.",
		promptSnippet: "Search local memory",
		parameters: recallSchema,
		execute: async (_id, params) => {
			const query = String((params as { query?: string }).query ?? "");
			const layer = asLayer((params as { layer?: string }).layer);
			try {
				const hits = await getMemory().recall(query, layer);
				const text =
					hits.length === 0
						? "no results"
						: hits.map((hit) => `[${hit.layer} ${hit.kind}] ${hit.text}`).join("\n");
				return { content: [{ type: "text", text }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `search failed: ${String(error)}` }], details: undefined };
			}
		},
		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatRecallDisplay(getTextOutput(result, context.showImages), theme));
			return text;
		},
	};
	const forget: ToolDefinition = {
		name: "forget",
		label: "forget",
		description: "Delete the closest memory in one layer.",
		promptSnippet: "Delete one memory",
		parameters: forgetSchema,
		execute: async (_id, params) => {
			const query = String((params as { query?: string }).query ?? "");
			const layer = asLayer((params as { layer?: string }).layer);
			if (!layer) {
				return { content: [{ type: "text", text: "layer must be session, project, or global" }], details: undefined };
			}
			try {
				const result = await getMemory().forget(query, layer);
				return { content: [{ type: "text", text: result }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `delete failed: ${String(error)}` }], details: undefined };
			}
		},
	};
	return [remember, recall, forget];
}
