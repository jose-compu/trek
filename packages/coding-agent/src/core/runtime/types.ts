/**
 * 0.8.0 Runtime role registry (issues #85–#86).
 * models.json stays the API catalog. This file is the hierarchy.
 */

export const HIERARCHY_MODES = ["api", "local", "hybrid"] as const;
export type HierarchyMode = (typeof HIERARCHY_MODES)[number];

export const SUITE_IDS = ["mistral", "mistral-pro", "qwen", "lfm"] as const;
export type SuiteId = (typeof SUITE_IDS)[number];

export const LAYERING_MODES = ["single", "auto", "manual"] as const;
export type LayeringMode = (typeof LAYERING_MODES)[number];

export const ROLE_THINKING = ["off", "brief", "deep"] as const;
export type RoleThinking = (typeof ROLE_THINKING)[number];

export const RUNTIME_ROLES = [
	"decision",
	"tooling",
	"workhorse",
	"planning",
	"frontier",
	"verifier",
	"embedding",
	"reranker",
] as const;
export type RuntimeRole = (typeof RUNTIME_ROLES)[number];

/** Extra stack roles cleared by `/hierarchy single`. */
export const LAYERING_EXTRA_ROLES = ["tooling", "planning", "frontier", "verifier"] as const;
export type LayeringExtraRole = (typeof LAYERING_EXTRA_ROLES)[number];

/** Roles that may own a llama-server process. Decision never does. */
export const LOCAL_SERVER_ROLES = [
	"tooling",
	"workhorse",
	"planning",
	"frontier",
	"verifier",
	"embedding",
	"reranker",
] as const;
export type LocalServerRole = (typeof LOCAL_SERVER_ROLES)[number];

/** Chat processes a local session may start. Ladder: tooling → workhorse → planning. */
export const SESSION_LOCAL_ROLES = ["tooling", "workhorse", "planning"] as const;
export type SessionLocalRole = (typeof SESSION_LOCAL_ROLES)[number];

export type RoleSource = "local" | "api" | "lmstudio";

export const DEFAULT_LMSTUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

export interface RoleAssignment {
	source: RoleSource;
	id: string;
	provider?: string;
	thinking: RoleThinking;
	repo?: string;
	/** LM Studio or another OpenAI-compatible server. Default is 127.0.0.1:1234/v1. */
	baseUrl?: string;
}

export interface HierarchySettings {
	mode: HierarchyMode;
	suite: SuiteId;
	quant: string;
	/** Factory default is single: one chat model on Workhorse. */
	layering: LayeringMode;
	/** Roles `/hierarchy role --clear` unbound. Suite presets do not fill these. */
	unbound?: RuntimeRole[];
}

export const ROUTE_COMPONENTS = ["worldModel", "toolIntent", "mechanical", "intend"] as const;
export type RouteComponent = (typeof ROUTE_COMPONENTS)[number];

/** Session roles a component may be pinned to. Embedding and reranker are not chat routes. */
export type RouteRole = "tooling" | "workhorse" | "planning" | "frontier";

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
	return value === "tooling" || value === "workhorse" || value === "planning" || value === "frontier";
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
			layering: "single",
		},
		roles: {},
	};
}

export function isHierarchyMode(value: string): value is HierarchyMode {
	return (HIERARCHY_MODES as readonly string[]).includes(value);
}

export function isLayeringMode(value: string): value is LayeringMode {
	return (LAYERING_MODES as readonly string[]).includes(value);
}

export function isRoleThinking(value: string): value is RoleThinking {
	return (ROLE_THINKING as readonly string[]).includes(value);
}

export function isLayeringExtraRole(value: string): value is LayeringExtraRole {
	return (LAYERING_EXTRA_ROLES as readonly string[]).includes(value);
}

/** YAML 1.1 may parse `off`/`on` as booleans. `true`/`on` mean deep. */
export function parseRoleThinking(value: unknown): RoleThinking | undefined {
	if (value === true || value === "true" || value === "on") {
		return "deep";
	}
	if (value === false || value === "false" || value === "off") {
		return "off";
	}
	if (typeof value === "string" && isRoleThinking(value)) {
		return value;
	}
	return undefined;
}

export function roleThinkingEnabled(thinking: RoleThinking): boolean {
	return thinking !== "off";
}

export function defaultRoleThinking(role: RuntimeRole): RoleThinking {
	return role === "planning" || role === "frontier" ? "deep" : "off";
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
