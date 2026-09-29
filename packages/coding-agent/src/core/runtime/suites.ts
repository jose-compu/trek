/**
 * Local suite presets (PROMPT §6, §20, issue #91).
 * Applied only when hierarchy.mode is local or hybrid.
 */

import type { RoleAssignment, SuiteId } from "./types.ts";

export interface SuitePreset {
	id: SuiteId;
	/** Same embedding and reranker family. LFM ColBERT has no separate reranker. */
	rerank: boolean;
	roles: {
		embedding: RoleAssignment;
		reranker?: RoleAssignment;
		tooling: RoleAssignment;
		workhorse: RoleAssignment;
		planning: RoleAssignment;
	};
}

function local(id: string, thinking: boolean, repo?: string): RoleAssignment {
	return {
		source: "local",
		id,
		thinking,
		repo: repo ?? id,
	};
}

const mistralRoles = {
	embedding: local("sentence-transformers/all-MiniLM-L6-v2", false),
	reranker: local("cross-encoder/ms-marco-MiniLM-L-6-v2", false),
	tooling: local("Cactus-Compute/needle", false),
	workhorse: local("Ministral-3-3B-Instruct-2512", false),
	planning: local("Ministral-3-8B-Reasoning-2512", true),
};

export const SUITE_PRESETS: Record<SuiteId, SuitePreset> = {
	mistral: {
		id: "mistral",
		rerank: true,
		roles: mistralRoles,
	},
	"mistral-pro": {
		id: "mistral-pro",
		rerank: true,
		roles: {
			...mistralRoles,
			workhorse: local("Devstral-Small-2507", false),
		},
	},
	qwen: {
		id: "qwen",
		rerank: true,
		roles: {
			embedding: local("Qwen3-Embedding-0.6B", false),
			reranker: local("Qwen3-Reranker-0.6B", false),
			tooling: local("Qwen3.5-0.8B", false),
			workhorse: local("Qwen3.5-4B", false),
			planning: local("Qwen3.5-9B", true),
		},
	},
	lfm: {
		id: "lfm",
		rerank: false,
		roles: {
			embedding: local("LFM2-ColBERT-350M", false),
			tooling: local("LFM2.5-350M", false),
			workhorse: local("LFM2.5-1.2B-Instruct", false),
			planning: local("LFM2.5-8B-A1B", true),
		},
	},
};

export function suitePreset(id: SuiteId): SuitePreset {
	return SUITE_PRESETS[id];
}
