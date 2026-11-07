/**
 * ~/.trek/models.yaml plus project .trek/models.yaml.
 * The project file overrides hierarchy fields and individual roles.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { CONFIG_DIR_NAME } from "../../config.ts";
import {
	assertPublicModelId,
	DEFAULT_LMSTUDIO_BASE_URL,
	defaultRuntimeConfig,
	type HierarchySettings,
	isHierarchyMode,
	isLayeringMode,
	isRoleSource,
	isRouteComponent,
	isRouteRole,
	isRuntimeRole,
	isSuiteId,
	LAYERING_EXTRA_ROLES,
	type LayeringMode,
	parseRoleThinking,
	type RoleAssignment,
	type RoleSource,
	type RouteComponent,
	type RouteRole,
	type RuntimeConfig,
	type RuntimeRole,
} from "./types.ts";

export function globalModelsYamlPath(agentDir: string): string {
	return join(dirname(agentDir), "models.yaml");
}

export function projectModelsYamlPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "models.yaml");
}

export function loadRuntimeConfig(input: { agentDir: string; cwd: string }): RuntimeConfig {
	const config = defaultRuntimeConfig();
	applyFile(config, globalModelsYamlPath(input.agentDir));
	applyFile(config, projectModelsYamlPath(input.cwd));
	return config;
}

export function readRuntimeConfigFile(path: string): RuntimeConfig {
	const config = defaultRuntimeConfig();
	applyFile(config, path);
	return config;
}

export function writeRuntimeConfigFile(path: string, config: RuntimeConfig): void {
	for (const role of Object.values(config.roles)) {
		if (role) {
			assertPublicModelId(role.id);
		}
	}
	mkdirSync(dirname(path), { recursive: true });
	const body = stringify({
		hierarchy: config.hierarchy,
		roles: config.roles,
		...(config.routing ? { routing: config.routing } : {}),
	});
	writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`);
}

function applyFile(config: RuntimeConfig, path: string): void {
	if (!existsSync(path)) {
		return;
	}
	let raw: unknown;
	try {
		raw = parse(readFileSync(path, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot parse ${path}: ${message}`);
	}
	if (raw === null || raw === undefined || raw === "") {
		return;
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Cannot parse ${path}: expected a mapping.`);
	}
	const record = raw as Record<string, unknown>;
	if (record.hierarchy !== undefined) {
		config.hierarchy = parseHierarchy(record.hierarchy, path, config.hierarchy);
	}
	if (record.roles !== undefined) {
		config.roles = {
			...config.roles,
			...parseRoles(record.roles, path),
		};
	}
	if (record.routing !== undefined) {
		config.routing = parseRouting(record.routing, path);
	}
}

function parseRouting(value: unknown, path: string): RuntimeConfig["routing"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path}: routing must be a mapping.`);
	}
	const record = value as Record<string, unknown>;
	if (record.components === undefined) {
		return {};
	}
	if (!record.components || typeof record.components !== "object" || Array.isArray(record.components)) {
		throw new Error(`${path}: routing.components must be a mapping.`);
	}
	const components: Partial<Record<RouteComponent, RouteRole>> = {};
	for (const [name, role] of Object.entries(record.components as Record<string, unknown>)) {
		if (!isRouteComponent(name)) {
			throw new Error(`${path}: unknown routing component ${name}.`);
		}
		if (typeof role !== "string") {
			throw new Error(`${path}: routing.components.${name} must be a chat role.`);
		}
		const mapped = role === "tooling" ? "workhorse" : role;
		if (!isRouteRole(mapped)) {
			throw new Error(`${path}: routing.components.${name} must be a chat role.`);
		}
		components[name] = mapped;
	}
	return { components };
}

function parseHierarchy(value: unknown, path: string, current: HierarchySettings): HierarchySettings {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path}: hierarchy must be a mapping.`);
	}
	const record = value as Record<string, unknown>;
	const next = { ...current };
	if (record.mode !== undefined) {
		if (typeof record.mode !== "string" || !isHierarchyMode(record.mode)) {
			throw new Error(`${path}: hierarchy.mode must be api, local, or hybrid.`);
		}
		next.mode = record.mode;
	}
	if (record.suite !== undefined) {
		if (typeof record.suite !== "string" || !isSuiteId(record.suite)) {
			throw new Error(`${path}: hierarchy.suite must be mistral, mistral-pro, qwen, or lfm.`);
		}
		next.suite = record.suite;
	}
	if (record.quant !== undefined) {
		if (typeof record.quant !== "string" || !record.quant.trim()) {
			throw new Error(`${path}: hierarchy.quant must be a string.`);
		}
		next.quant = record.quant;
	}
	if (record.layering !== undefined) {
		if (typeof record.layering !== "string" || !isLayeringMode(record.layering)) {
			throw new Error(`${path}: hierarchy.layering must be single, auto, or manual.`);
		}
		next.layering = record.layering;
	} else if (next.mode === "local" || next.mode === "hybrid") {
		next.layering = "manual";
	}
	if (record.unbound !== undefined) {
		if (!Array.isArray(record.unbound)) {
			throw new Error(`${path}: hierarchy.unbound must be a list of roles.`);
		}
		const unbound: RuntimeRole[] = [];
		for (const item of record.unbound) {
			if (typeof item !== "string" || !isRuntimeRole(item)) {
				throw new Error(`${path}: hierarchy.unbound entries must be role names.`);
			}
			unbound.push(item);
		}
		if (unbound.length > 0) {
			next.unbound = [...new Set(unbound)];
		} else {
			delete next.unbound;
		}
	}
	return next;
}

function parseRoles(value: unknown, path: string): Partial<Record<RuntimeRole, RoleAssignment>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path}: roles must be a mapping.`);
	}
	const roles: Partial<Record<RuntimeRole, RoleAssignment>> = {};
	for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!isRuntimeRole(name)) {
			throw new Error(`${path}: unknown role ${name}.`);
		}
		roles[name] = parseRole(raw, `${path} roles.${name}`);
	}
	return roles;
}

function parseRole(value: unknown, label: string): RoleAssignment {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a mapping.`);
	}
	const record = value as Record<string, unknown>;
	if (typeof record.source !== "string" || !isRoleSource(record.source)) {
		throw new Error(`${label}: source must be local, api, or lmstudio.`);
	}
	if (typeof record.id !== "string") {
		throw new Error(`${label}: id must be a string.`);
	}
	assertPublicModelId(record.id);
	const thinking = parseRoleThinking(record.thinking);
	if (thinking === undefined) {
		throw new Error(`${label}: thinking must be off, brief, deep, or a YAML boolean.`);
	}
	const role: RoleAssignment = {
		source: record.source as RoleSource,
		id: record.id,
		thinking,
	};
	if (record.provider !== undefined) {
		if (typeof record.provider !== "string" || !record.provider.trim()) {
			throw new Error(`${label}: provider must be a string.`);
		}
		role.provider = record.provider;
	}
	if (record.repo !== undefined) {
		if (typeof record.repo !== "string" || !record.repo.trim()) {
			throw new Error(`${label}: repo must be a string.`);
		}
		role.repo = record.repo;
	}
	if (record.baseUrl !== undefined) {
		if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) {
			throw new Error(`${label}: baseUrl must be a string.`);
		}
		role.baseUrl = record.baseUrl;
	} else if (role.source === "lmstudio") {
		role.baseUrl = DEFAULT_LMSTUDIO_BASE_URL;
	}
	return role;
}

export function withHierarchy(
	config: RuntimeConfig,
	patch: Partial<Pick<HierarchySettings, "mode" | "suite" | "quant" | "layering">>,
): RuntimeConfig {
	return {
		hierarchy: { ...config.hierarchy, ...patch },
		roles: config.roles,
		...(config.routing ? { routing: config.routing } : {}),
	};
}

function hierarchyWithUnbound(hierarchy: HierarchySettings, unbound: RuntimeRole[]): HierarchySettings {
	const next = { ...hierarchy };
	const unique = [...new Set(unbound)];
	if (unique.length > 0) {
		next.unbound = unique;
	} else {
		delete next.unbound;
	}
	return next;
}

export function withRoleOverride(config: RuntimeConfig, role: RuntimeRole, assignment: RoleAssignment): RuntimeConfig {
	assertPublicModelId(assignment.id);
	const unbound = (config.hierarchy.unbound ?? []).filter((name) => name !== role);
	return {
		hierarchy: hierarchyWithUnbound({ ...config.hierarchy, layering: "manual" }, unbound),
		roles: { ...config.roles, [role]: assignment },
		...(config.routing ? { routing: config.routing } : {}),
	};
}

/** Beginner stack: one chat model on Workhorse. Extra roles alias it at resolve time. */
export function flattenToSingle(config: RuntimeConfig): RuntimeConfig {
	const roles = { ...config.roles };
	for (const role of LAYERING_EXTRA_ROLES) {
		delete roles[role];
	}
	const hierarchy = { ...config.hierarchy, layering: "single" as const };
	delete hierarchy.unbound;
	return {
		hierarchy,
		roles,
		...(config.routing ? { routing: config.routing } : {}),
	};
}

export function withClearedRole(config: RuntimeConfig, role: RuntimeRole): RuntimeConfig {
	const roles = { ...config.roles };
	delete roles[role];
	return {
		hierarchy: hierarchyWithUnbound({ ...config.hierarchy, layering: "manual" }, [
			...(config.hierarchy.unbound ?? []),
			role,
		]),
		roles,
		...(config.routing ? { routing: config.routing } : {}),
	};
}

function readProjectYaml(cwd: string): { path: string; record: Record<string, unknown> } | undefined {
	const path = projectModelsYamlPath(cwd);
	if (!existsSync(path)) {
		return undefined;
	}
	let raw: unknown;
	try {
		raw = parse(readFileSync(path, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot parse ${path}: ${message}`);
	}
	const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return { path, record };
}

function writeProjectYaml(path: string, record: Record<string, unknown>): void {
	const body = stringify(record);
	writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`);
}

function projectRoles(record: Record<string, unknown>): Record<string, unknown> {
	if (record.roles && typeof record.roles === "object" && !Array.isArray(record.roles)) {
		return { ...(record.roles as Record<string, unknown>) };
	}
	return {};
}

function applyProjectLayering(record: Record<string, unknown>, layering: LayeringMode, clearExtras: boolean): void {
	const hierarchy =
		record.hierarchy && typeof record.hierarchy === "object" && !Array.isArray(record.hierarchy)
			? { ...(record.hierarchy as Record<string, unknown>) }
			: {};
	hierarchy.layering = layering;
	if (clearExtras) {
		delete hierarchy.unbound;
		const roles = projectRoles(record);
		for (const role of LAYERING_EXTRA_ROLES) {
			delete roles[role];
		}
		record.roles = roles;
	}
	record.hierarchy = hierarchy;
}

/** Keep project `.trek/models.yaml` from overriding a global layering write. */
export function syncProjectLayering(cwd: string, layering: LayeringMode, clearExtras: boolean): void {
	const loaded = readProjectYaml(cwd);
	if (!loaded) {
		return;
	}
	applyProjectLayering(loaded.record, layering, clearExtras);
	writeProjectYaml(loaded.path, loaded.record);
}

const AUTO_MAPPED_ROLES = ["tooling", "workhorse", "planning", "frontier", "verifier"] as const;

/** Write catalog-mapped chat roles into the project file so stale pins cannot win the merge. */
export function syncProjectAutoMap(cwd: string, config: RuntimeConfig): void {
	const loaded = readProjectYaml(cwd);
	if (!loaded) {
		return;
	}
	applyProjectLayering(loaded.record, config.hierarchy.layering, true);
	const roles = projectRoles(loaded.record);
	for (const name of AUTO_MAPPED_ROLES) {
		const assignment = config.roles[name];
		if (!assignment) {
			delete roles[name];
			continue;
		}
		roles[name] = {
			source: assignment.source,
			id: assignment.id,
			thinking: assignment.thinking,
			...(assignment.provider ? { provider: assignment.provider } : {}),
			...(assignment.repo ? { repo: assignment.repo } : {}),
			...(assignment.baseUrl ? { baseUrl: assignment.baseUrl } : {}),
		};
	}
	const hierarchy = loaded.record.hierarchy as Record<string, unknown>;
	delete hierarchy.unbound;
	loaded.record.hierarchy = hierarchy;
	loaded.record.roles = roles;
	writeProjectYaml(loaded.path, loaded.record);
}

/** Bind or clear one role in the project file, and set layering to manual. */
export function syncProjectRole(cwd: string, role: RuntimeRole, assignment: RoleAssignment | undefined): void {
	const loaded = readProjectYaml(cwd);
	if (!loaded) {
		return;
	}
	applyProjectLayering(loaded.record, "manual", false);
	const roles = projectRoles(loaded.record);
	const hierarchy = loaded.record.hierarchy as Record<string, unknown>;
	const unbound = Array.isArray(hierarchy.unbound)
		? hierarchy.unbound.filter((item): item is string => typeof item === "string" && item !== role)
		: [];
	if (assignment) {
		roles[role] = {
			source: assignment.source,
			id: assignment.id,
			thinking: assignment.thinking,
			...(assignment.provider ? { provider: assignment.provider } : {}),
			...(assignment.repo ? { repo: assignment.repo } : {}),
			...(assignment.baseUrl ? { baseUrl: assignment.baseUrl } : {}),
		};
	} else {
		delete roles[role];
		unbound.push(role);
	}
	if (unbound.length > 0) {
		hierarchy.unbound = [...new Set(unbound)];
	} else {
		delete hierarchy.unbound;
	}
	loaded.record.hierarchy = hierarchy;
	loaded.record.roles = roles;
	writeProjectYaml(loaded.path, loaded.record);
}
