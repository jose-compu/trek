/**
 * Local suite presets (PROMPT §6, §20, issue #91).
 * Applied only when hierarchy.mode is local or hybrid.
 * Ladder: Decision → Tooling → Workhorse → Planning (+ Frontier in hybrid).
 *
 * Decision is always Liquid d1 (LFM family). Mistral / Qwen / mistral-pro have no
 * suite-native Decision model, so they reuse the same LFM `d1-omni-600M` weights.
 */

import type { RoleAssignment, SuiteId } from "./types.ts";

export interface SuitePreset {
	id: SuiteId;
	/** Rerank on by default in every suite. Memory uses a local MiniLM CE when the suite has no family pair. */
	rerank: boolean;
	roles: {
		/** Liquid d1 classifier (not llama-server). Shared LFM default across suites. */
		decision: RoleAssignment;
		tooling: RoleAssignment;
		embedding: RoleAssignment;
		reranker: RoleAssignment;
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

/** Shared Decision Index id (LFM). Used by every suite that lacks a native Decision model. */
export const DEFAULT_DECISION_MODEL_ID = "LiquidAI/d1-omni-600M";

/** Default Decision Index assignment across suites (open weights; classify-only). */
const DECISION = local(DEFAULT_DECISION_MODEL_ID, false, DEFAULT_DECISION_MODEL_ID);

const mistralRoles = {
	decision: DECISION,
	tooling: local("Qwen3.5-0.8B", false),
	embedding: local("sentence-transformers/all-MiniLM-L6-v2", false),
	reranker: local("cross-encoder/ms-marco-MiniLM-L-6-v2", false),
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
			decision: DECISION,
			tooling: local("Qwen3.5-0.8B", false),
			embedding: local("Qwen3-Embedding-0.6B", false),
			reranker: local("Qwen3-Reranker-0.6B", false),
			workhorse: local("Qwen3.5-4B", false),
			planning: local("Qwen3.5-9B", true),
		},
	},
	lfm: {
		id: "lfm",
		rerank: true,
		roles: {
			decision: DECISION,
			tooling: local("LFM2.5-350M", false),
			embedding: local("LFM2-ColBERT-350M", false),
			/** ColBERT has no sibling CE; MiniLM is the default second-pass scorer. */
			reranker: local("cross-encoder/ms-marco-MiniLM-L-6-v2", false),
			workhorse: local("LFM2.5-1.2B-Instruct", false),
			planning: local("LFM2.5-8B-A1B", true),
		},
	},
};

export function suitePreset(id: SuiteId): SuitePreset {
	return SUITE_PRESETS[id];
}
