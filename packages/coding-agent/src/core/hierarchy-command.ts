/**
 * /hierarchy writes the same ~/.trek/models.yaml as `trek models`.
 * The next session reads the file. This command does not start llama.cpp.
 */

import { getAgentDir } from "../config.ts";
import { applyAutoLayering, loadCatalogFixture } from "./runtime/catalog-map.ts";
import {
	DEFAULT_LMSTUDIO_BASE_URL,
	defaultRoleThinking,
	flattenToSingle,
	globalModelsYamlPath,
	isHierarchyMode,
	isLayeringMode,
	isRuntimeRole,
	isSuiteId,
	loadRuntimeConfig,
	parseRoleThinking,
	type RoleAssignment,
	type RoleSource,
	type RuntimeRole,
	readRuntimeConfigFile,
	resolveRuntime,
	skipExtraRole,
	syncProjectLayering,
	syncProjectRole,
	withClearedRole,
	withHierarchy,
	withRoleOverride,
	writeRuntimeConfigFile,
} from "./runtime/index.ts";

const ROLE_ORDER: RuntimeRole[] = [
	"decision",
	"tooling",
	"workhorse",
	"planning",
	"frontier",
	"verifier",
	"embedding",
	"reranker",
];

const USAGE =
	"Usage: /hierarchy | /hierarchy auto | /hierarchy single | /hierarchy manual | /hierarchy mode <mode> | /hierarchy suite <suite> | /hierarchy role <role> --id <id> [--source api|local|lmstudio] [--thinking off|brief|deep|on] | /hierarchy role <role> --clear";

export function runHierarchyCommand(agentDir: string, cwd: string, arg: string): string {
	const path = globalModelsYamlPath(agentDir);
	const parts = arg
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	if (parts.length === 0) {
		return status(agentDir, cwd, path);
	}
	const [kind, ...rest] = parts;
	try {
		if (kind === "auto" || kind === "single" || kind === "manual") {
			return setLayering(path, agentDir, cwd, kind, rest);
		}
		if (kind === "mode") {
			const mode = rest[0];
			if (!mode || !isHierarchyMode(mode)) {
				return "Usage: /hierarchy mode api|local|hybrid";
			}
			const current = readRuntimeConfigFile(path);
			writeRuntimeConfigFile(path, withHierarchy(current, { mode }));
			return nextSession(status(agentDir, cwd, path));
		}
		if (kind === "suite") {
			const suite = rest[0];
			if (!suite || !isSuiteId(suite)) {
				return "Usage: /hierarchy suite mistral|mistral-pro|qwen|lfm";
			}
			const current = readRuntimeConfigFile(path);
			writeRuntimeConfigFile(path, withHierarchy(current, { suite }));
			return nextSession(status(agentDir, cwd, path));
		}
		if (kind === "role") {
			return setRole(path, agentDir, cwd, rest);
		}
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return USAGE;
}

export function hierarchyAgentDir(): string {
	return getAgentDir();
}

function setLayering(
	path: string,
	agentDir: string,
	cwd: string,
	mode: "auto" | "single" | "manual",
	rest: string[] = [],
): string {
	if (!isLayeringMode(mode)) {
		return "Usage: /hierarchy auto|single|manual [--catalog <file>]";
	}
	const current = readRuntimeConfigFile(path);
	let next = mode === "single" ? flattenToSingle(current) : withHierarchy(current, { layering: mode });
	if (mode === "auto") {
		const catalogPath = flagValue(rest, "--catalog");
		if (catalogPath) {
			next = applyAutoLayering(current, loadCatalogFixture(catalogPath));
		}
	}
	writeRuntimeConfigFile(path, next);
	syncProjectLayering(cwd, next.hierarchy.layering, next.hierarchy.layering === "single");
	return nextSession(status(agentDir, cwd, path));
}

function setRole(path: string, agentDir: string, cwd: string, rest: string[]): string {
	const roleName = rest[0];
	if (!roleName || !isRuntimeRole(roleName)) {
		return "Usage: /hierarchy role <decision|tooling|workhorse|planning|frontier|verifier|embedding|reranker> --id <id>";
	}
	if (rest.includes("--clear")) {
		const current = readRuntimeConfigFile(path);
		writeRuntimeConfigFile(path, withClearedRole(current, roleName as RuntimeRole));
		syncProjectRole(cwd, roleName as RuntimeRole, undefined);
		return nextSession(status(agentDir, cwd, path));
	}
	const id = flagValue(rest, "--id");
	if (!id) {
		return "role requires --id (or --clear).";
	}
	const sourceFlag = flagValue(rest, "--source");
	if (sourceFlag !== undefined && sourceFlag !== "api" && sourceFlag !== "local" && sourceFlag !== "lmstudio") {
		return "role --source must be api, local, or lmstudio.";
	}
	const source: RoleSource =
		sourceFlag === "api" || sourceFlag === "local" || sourceFlag === "lmstudio"
			? sourceFlag
			: roleName === "frontier" || roleName === "verifier"
				? "api"
				: "local";
	const thinkingFlag = flagValue(rest, "--thinking");
	let thinking = defaultRoleThinking(roleName as RuntimeRole);
	if (thinkingFlag !== undefined) {
		const parsed = parseRoleThinking(thinkingFlag);
		if (parsed === undefined) {
			return "role --thinking must be off, brief, deep, or on.";
		}
		thinking = parsed;
	}
	const assignment: RoleAssignment = { source, id, thinking };
	if (source === "lmstudio") {
		assignment.baseUrl = flagValue(rest, "--base-url") ?? DEFAULT_LMSTUDIO_BASE_URL;
	}
	const current = readRuntimeConfigFile(path);
	writeRuntimeConfigFile(path, withRoleOverride(current, roleName as RuntimeRole, assignment));
	syncProjectRole(cwd, roleName as RuntimeRole, assignment);
	return nextSession(status(agentDir, cwd, path));
}

function status(agentDir: string, cwd: string, path: string): string {
	const config = loadRuntimeConfig({ agentDir, cwd });
	const resolved = resolveRuntime(config);
	const lines = [
		`layering ${config.hierarchy.layering}`,
		`mode ${config.hierarchy.mode}`,
		`suite ${config.hierarchy.suite}`,
		`file ${path}`,
	];
	for (const role of ROLE_ORDER) {
		const assignment = skipExtraRole(config, role) ? undefined : (config.roles[role] ?? resolved.roles[role]);
		lines.push(
			assignment ? `${role} ${assignment.source} ${assignment.id} thinking ${assignment.thinking}` : `${role} unset`,
		);
	}
	return lines.join("\n");
}

function nextSession(body: string): string {
	return `${body}\nThe next session reads this file. This session does not start llama.cpp.`;
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
		return args[index + 1];
	}
	return undefined;
}
