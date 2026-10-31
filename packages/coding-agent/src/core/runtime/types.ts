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

/** Roles that may own a llama-server process. Frontier never does. Tooling is a yaml alias of workhorse. */
export const LOCAL_SERVER_ROLES = ["workhorse", "planning", "embedding", "reranker"] as const;
export type LocalServerRole = (typeof LOCAL_SERVER_ROLES)[number];

/** Chat processes a local session starts. Tooling is not loaded. */
export const SESSION_LOCAL_ROLES = ["workhorse", "planning"] as const;
export type SessionLocalRole = (typeof SESSION_LOCAL_ROLES)[number];

export type RoleSource = "local" | "api" | "lmstudio";

export const DEFAULT_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

export interface RoleAssignment {
	source: RoleSource;
	id: string;
	provider?: string;
	thinking: boolean;
	repo?: string;
	/** LM Studio or another OpenAI-compatible server. Default is 127.0.0.1:1234/v1. */
	baseUrl?: string;
}

export interface HierarchySettings {
	mode: HierarchyMode;
	suite: SuiteId;
	quant: string;
}

export const ROUTE_COMPONENTS = ["worldModel", "toolIntent", "mechanical", "intend"] as const;
export type RouteComponent = (typeof ROUTE_COMPONENTS)[number];

/** Session roles a component may be pinned to. Embedding and reranker are not chat routes. */
export type RouteRole = "workhorse" | "planning" | "frontier";

export interface RoutingPolicy {
	/** Static role per component. Absent components use the dynamic policy. */
	components?: Partial<Record<RouteComponent, RouteRole>>;
}

export interface RuntimeConfig {
	hierarchy: HierarchySettings;
	/** Overrides on top of the suite preset. */
	roles: Partial<Record<RuntimeRole, RoleAssignment>>;
	/** Optional pins. Dynamic routing is the default. */
	routing?: RoutingPolicy;
}

export function isRouteComponent(value: string): value is RouteComponent {
	return (ROUTE_COMPONENTS as readonly string[]).includes(value);
}

export function isRouteRole(value: string): value is RouteRole {
	return value === "workhorse" || value === "planning" || value === "frontier";
}

export function isRoleSource(value: string): value is RoleSource {
	return value === "local" || value === "api" || value === "lmstudio";
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
