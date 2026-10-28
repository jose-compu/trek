import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { MemoryLayer, MemoryManager } from "../memory/manager.ts";

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
