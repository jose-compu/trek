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
	defaultRuntimeConfig,
	type HierarchySettings,
	isHierarchyMode,
	isRuntimeRole,
	isSuiteId,
	type RoleAssignment,
	type RoleSource,
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
	if (record.source !== "local" && record.source !== "api") {
		throw new Error(`${label}: source must be local or api.`);
	}
	if (typeof record.id !== "string") {
		throw new Error(`${label}: id must be a string.`);
	}
	assertPublicModelId(record.id);
	if (typeof record.thinking !== "boolean") {
		throw new Error(`${label}: thinking must be true or false.`);
	}
	const role: RoleAssignment = {
		source: record.source as RoleSource,
		id: record.id,
		thinking: record.thinking,
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
	return role;
}

export function withHierarchy(
	config: RuntimeConfig,
	patch: Partial<Pick<HierarchySettings, "mode" | "suite" | "quant">>,
): RuntimeConfig {
	return {
		hierarchy: { ...config.hierarchy, ...patch },
		roles: config.roles,
	};
}

export function withRoleOverride(config: RuntimeConfig, role: RuntimeRole, assignment: RoleAssignment): RuntimeConfig {
	assertPublicModelId(assignment.id);
	return {
		hierarchy: config.hierarchy,
		roles: { ...config.roles, [role]: assignment },
	};
}
