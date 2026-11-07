/**
 * Local suite presets (PROMPT §6, §20, issue #91).
 * Applied only when hierarchy.mode is local or hybrid.
 * Climb: Decision → Workhorse → Planning (+ Frontier consult). Tooling is a runner.
 *
 * Decision is always Liquid d1 (LFM family). Mistral / Qwen / mistral-pro have no
 * suite-native Decision model, so they reuse the same LFM `d1-omni-600M` weights.
 */

import type { RoleAssignment, RoleThinking, SuiteId } from "./types.ts";

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

function local(id: string, thinking: RoleThinking, repo?: string): RoleAssignment {
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
const DECISION = local(DEFAULT_DECISION_MODEL_ID, "off", DEFAULT_DECISION_MODEL_ID);

const mistralRoles = {
	decision: DECISION,
	tooling: local("Qwen3.5-0.8B", "off"),
	embedding: local("sentence-transformers/all-MiniLM-L6-v2", "off"),
	reranker: local("cross-encoder/ms-marco-MiniLM-L-6-v2", "off"),
	workhorse: local("Ministral-3-3B-Instruct-2512", "off"),
	planning: local("Ministral-3-8B-Reasoning-2512", "deep"),
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
			workhorse: local("Devstral-Small-2507", "off"),
		},
	},
	qwen: {
		id: "qwen",
		rerank: true,
		roles: {
			decision: DECISION,
			tooling: local("Qwen3.5-0.8B", "off"),
			embedding: local("Qwen3-Embedding-0.6B", "off"),
			reranker: local("Qwen3-Reranker-0.6B", "off"),
			workhorse: local("Qwen3.5-4B", "off"),
			planning: local("Qwen3.5-9B", "deep"),
		},
	},
	lfm: {
		id: "lfm",
		rerank: true,
		roles: {
			decision: DECISION,
			tooling: local("LFM2.5-350M", "off"),
			embedding: local("LFM2-ColBERT-350M", "off"),
			/** ColBERT has no sibling CE; MiniLM is the default second-pass scorer. */
			reranker: local("cross-encoder/ms-marco-MiniLM-L-6-v2", "off"),
			workhorse: local("LFM2.5-1.2B-Instruct", "off"),
			planning: local("LFM2.5-8B-A1B", "deep"),
		},
	},
};

export function suitePreset(id: SuiteId): SuitePreset {
	return SUITE_PRESETS[id];
}
