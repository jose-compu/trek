/**
 * 0.8.0 Runtime role registry (issues #85–#86).
 * models.json stays the API catalog. This file is the hierarchy.
 */

export const HIERARCHY_MODES = ["api", "local", "hybrid"] as const;
export type HierarchyMode = (typeof HIERARCHY_MODES)[number];

export const SUITE_IDS = ["mistral", "mistral-pro", "qwen", "lfm"] as const;
export type SuiteId = (typeof SUITE_IDS)[number];

export const RUNTIME_ROLES = ["tooling", "workhorse", "planning", "frontier", "embedding", "reranker"] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];

/** Roles that may own a llama-server process. Frontier never does. */
export const LOCAL_SERVER_ROLES = ["tooling", "workhorse", "planning", "embedding", "reranker"] as const;
export type LocalServerRole = (typeof LOCAL_SERVER_ROLES)[number];

/** The three roles a local session actually starts. Embedding and reranker stay registered for 0.11.0. */
export const SESSION_LOCAL_ROLES = ["tooling", "workhorse", "planning"] as const;
export type SessionLocalRole = (typeof SESSION_LOCAL_ROLES)[number];

export type RoleSource = "local" | "api";

export interface RoleAssignment {
	source: RoleSource;
	id: string;
	provider?: string;
	thinking: boolean;
	repo?: string;
}

export interface HierarchySettings {
	mode: HierarchyMode;
	suite: SuiteId;
	quant: string;
}

export interface RuntimeConfig {
	hierarchy: HierarchySettings;
	/** Overrides on top of the suite preset. */
	roles: Partial<Record<RuntimeRole, RoleAssignment>>;
}

export const DEFAULT_QUANT = "q4_k_m";

export function defaultRuntimeConfig(): RuntimeConfig {
	return {
		hierarchy: {
			mode: "api",
			suite: "mistral",
			quant: DEFAULT_QUANT,
		},
		roles: {},
	};
}

export function isHierarchyMode(value: string): value is HierarchyMode {
	return (HIERARCHY_MODES as readonly string[]).includes(value);
}

export function isSuiteId(value: string): value is SuiteId {
	return (SUITE_IDS as readonly string[]).includes(value);
}

export function isRuntimeRole(value: string): value is RuntimeRole {
	return (RUNTIME_ROLES as readonly string[]).includes(value);
}

export function isLocalServerRole(value: string): value is LocalServerRole {
	return (LOCAL_SERVER_ROLES as readonly string[]).includes(value);
}

/** npm scopes and unpublished ids stay out of the role file. */
export function assertPublicModelId(id: string): void {
	if (!id.trim()) {
		throw new Error("Model id is empty.");
	}
	if (/^@|node_modules|unpublished/i.test(id)) {
		throw new Error(
			`Refusing private or unpublished model id ${id}. Use a public model id. The API catalog stays in models.json.`,
		);
	}
}
