/**
 * Each local chat family speaks a different tool-call dialect.
 * llama.cpp b11262 parses these three. Mixing them drops the call.
 *
 * lfm:     <|tool_call_start|>[name(arg='value')]<|tool_call_end|>
 * qwen:    <tool_call><function=name><parameter=arg>value</parameter></tool_call>
 * mistral: [TOOL_CALLS]name[ARGS]{json}
 *
 * The Qwen and Ministral GGUF templates already render their dialect.
 * The LFM GGUF template only pastes a JSON tool list, so that family
 * loads Liquid's template instead.
 */

import { SUITE_PRESETS } from "./suites.ts";
import type { SuiteId } from "./types.ts";

export const TOOL_DIALECTS = {
	lfm: "<|tool_call_start|>",
	qwen: "<tool_call>",
	mistral: "[TOOL_CALLS]",
} as const;

export type ToolDialect = keyof typeof TOOL_DIALECTS;

const CHAT_ROLES = ["tooling", "workhorse", "planning"] as const;

export function toolDialect(modelId: string): ToolDialect | undefined {
	if (modelId.startsWith("LFM2.5")) {
		return "lfm";
	}
	if (modelId.startsWith("Qwen3.5")) {
		return "qwen";
	}
	if (modelId.startsWith("Ministral-") || modelId.startsWith("Devstral-")) {
		return "mistral";
	}
	return undefined;
}

export interface SuiteChatDialect {
	suite: SuiteId;
	role: (typeof CHAT_ROLES)[number];
	id: string;
	dialect: ToolDialect;
}

/** Chat roles only. Embeddings and rerankers are not tool dialects. */
export function suiteChatDialects(): SuiteChatDialect[] {
	const rows: SuiteChatDialect[] = [];
	for (const preset of Object.values(SUITE_PRESETS)) {
		for (const role of CHAT_ROLES) {
			const id = preset.roles[role].id;
			const dialect = toolDialect(id);
			if (!dialect) {
				throw new Error(`${preset.id} ${role} ${id} has no tool dialect.`);
			}
			rows.push({ suite: preset.id, role, id, dialect });
		}
	}
	return rows;
}
