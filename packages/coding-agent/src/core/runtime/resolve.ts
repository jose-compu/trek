/**
 * Default mode is api: no llama.cpp.
 * local promotes to hybrid when a Frontier API key is present (issue #87, #90).
 */

import { suitePreset } from "./suites.ts";
import type { HierarchyMode, RoleAssignment, RuntimeConfig, RuntimeRole } from "./types.ts";
import { SESSION_LOCAL_ROLES, type SessionLocalRole } from "./types.ts";

export interface FrontierHint {
	provider: string;
	modelId?: string;
}

export interface ResolveRuntimeOptions {
	env?: NodeJS.ProcessEnv;
	/**
	 * When set, used instead of env detection.
	 * `null` forces no Frontier key.
	 */
	frontier?: FrontierHint | null;
}

export interface ResolvedRuntime {
	mode: HierarchyMode;
	effectiveMode: HierarchyMode;
	suite: RuntimeConfig["hierarchy"]["suite"];
	quant: string;
	rerank: boolean;
	presetRoles: Partial<Record<RuntimeRole, RoleAssignment>>;
	/** Roles that are in effect for this mode. */
	roles: Partial<Record<RuntimeRole, RoleAssignment>>;
	requiresHuggingFaceToken: boolean;
	frontierAvailable: boolean;
}

const FRONTIER_ENV = [
	{ env: "XAI_API_KEY", provider: "xai" },
	{ env: "OPENAI_API_KEY", provider: "openai" },
	{ env: "ANTHROPIC_API_KEY", provider: "anthropic" },
	{ env: "GEMINI_API_KEY", provider: "google" },
	{ env: "GOOGLE_API_KEY", provider: "google" },
] as const;

export function detectFrontier(env: NodeJS.ProcessEnv = process.env): FrontierHint | undefined {
	for (const entry of FRONTIER_ENV) {
		const value = env[entry.env];
		if (typeof value === "string" && value.trim()) {
			return { provider: entry.provider, modelId: "frontier" };
		}
	}
	return undefined;
}

export function requiresHuggingFaceToken(mode: HierarchyMode): boolean {
	return mode !== "api";
}

export function resolveRuntime(config: RuntimeConfig, options: ResolveRuntimeOptions = {}): ResolvedRuntime {
	const preset = suitePreset(config.hierarchy.suite);
	const presetRoles: Partial<Record<RuntimeRole, RoleAssignment>> = { ...preset.roles };
	const frontier =
		options.frontier === undefined ? detectFrontier(options.env ?? process.env) : (options.frontier ?? undefined);
	const frontierAvailable = frontier !== undefined;

	let effectiveMode = config.hierarchy.mode;
	if (effectiveMode === "local" && frontierAvailable) {
		effectiveMode = "hybrid";
	}

	const roles: Partial<Record<RuntimeRole, RoleAssignment>> = {};
	if (effectiveMode === "api") {
		roles.frontier = frontierRole(frontier);
	} else {
		for (const [name, assignment] of Object.entries(preset.roles) as [RuntimeRole, RoleAssignment][]) {
			roles[name] = overlay(assignment, config.roles[name]);
		}
		for (const [name, assignment] of Object.entries(config.roles) as [RuntimeRole, RoleAssignment][]) {
			if (!roles[name] && assignment) {
				roles[name] = assignment;
			}
		}
		if (effectiveMode === "hybrid") {
			roles.frontier = overlay(frontierRole(frontier), config.roles.frontier);
		}
	}

	return {
		mode: config.hierarchy.mode,
		effectiveMode,
		suite: config.hierarchy.suite,
		quant: config.hierarchy.quant,
		rerank: preset.rerank,
		presetRoles,
		roles,
		requiresHuggingFaceToken: requiresHuggingFaceToken(effectiveMode),
		frontierAvailable,
	};
}

export function sessionLocalRoles(resolved: ResolvedRuntime): SessionLocalRole[] {
	if (resolved.effectiveMode === "api") {
		return [];
	}
	return [...SESSION_LOCAL_ROLES];
}

function frontierRole(frontier: FrontierHint | undefined): RoleAssignment {
	const role: RoleAssignment = {
		source: "api",
		id: frontier?.modelId ?? "frontier",
		thinking: true,
	};
	if (frontier?.provider) {
		role.provider = frontier.provider;
	}
	return role;
}

function overlay(base: RoleAssignment | undefined, override: RoleAssignment | undefined): RoleAssignment | undefined {
	if (!override) {
		return base;
	}
	if (!base) {
		return override;
	}
	return {
		...base,
		...override,
		source: override.source,
		thinking: override.thinking,
	};
}

export function formatRuntimeStatus(resolved: ResolvedRuntime): string {
	const lines = [
		`hierarchy.mode: ${resolved.mode}`,
		`effective: ${resolved.effectiveMode}`,
		`suite: ${resolved.suite}`,
		`quant: ${resolved.quant}`,
		`huggingFaceToken: ${resolved.requiresHuggingFaceToken ? "required for local weights" : "not required"}`,
		`rerank: ${resolved.rerank ? "on" : "off"}`,
	];
	const order: RuntimeRole[] = ["tooling", "workhorse", "planning", "embedding", "reranker", "frontier"];
	for (const name of order) {
		const active = resolved.roles[name];
		const preset = resolved.presetRoles[name];
		const shown = active ?? preset;
		if (!shown) {
			continue;
		}
		const state = active ? "active" : "inactive";
		const provider = shown.provider ? ` provider ${shown.provider}` : "";
		lines.push(`${name} ${shown.source} ${shown.id}${provider} thinking ${shown.thinking ? "on" : "off"} ${state}`);
	}
	return lines.join("\n");
}
