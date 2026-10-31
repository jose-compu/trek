/**
 * /hierarchy writes the same ~/.trek/models.yaml as `trek models`.
 * The next session reads the file. This command does not start llama.cpp.
 */

import { getAgentDir } from "../config.ts";
import {
	globalModelsYamlPath,
	isHierarchyMode,
	isRuntimeRole,
	isSuiteId,
	loadRuntimeConfig,
	type RoleAssignment,
	type RuntimeRole,
	readRuntimeConfigFile,
	withHierarchy,
	withRoleOverride,
	writeRuntimeConfigFile,
} from "./runtime/index.ts";

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
		if (kind === "mode") {
			const mode = rest[0];
			if (!mode || !isHierarchyMode(mode)) {
				return "Usage: /hierarchy mode api|local|hybrid";
			}
			const current = readRuntimeConfigFile(path);
			writeRuntimeConfigFile(path, withHierarchy(current, { mode }));
			return `${status(agentDir, cwd, path)}\nThe next session reads this file. This session does not start llama.cpp.`;
		}
		if (kind === "suite") {
			const suite = rest[0];
			if (!suite || !isSuiteId(suite)) {
				return "Usage: /hierarchy suite mistral|mistral-pro|qwen|lfm";
			}
			const current = readRuntimeConfigFile(path);
			writeRuntimeConfigFile(path, withHierarchy(current, { suite }));
			return `${status(agentDir, cwd, path)}\nThe next session reads this file. This session does not start llama.cpp.`;
		}
		if (kind === "role") {
			return setRole(path, agentDir, cwd, rest);
		}
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return "Usage: /hierarchy | /hierarchy mode <mode> | /hierarchy suite <suite> | /hierarchy role <role> --id <id> [--source local|api] [--thinking on|off]";
}

export function hierarchyAgentDir(): string {
	return getAgentDir();
}

function setRole(path: string, agentDir: string, cwd: string, rest: string[]): string {
	const roleName = rest[0];
	if (!roleName || !isRuntimeRole(roleName)) {
		return "Usage: /hierarchy role <tooling|workhorse|planning|frontier|embedding|reranker> --id <id>";
	}
	const id = flagValue(rest, "--id");
	if (!id) {
		return "role requires --id.";
	}
	const sourceFlag = flagValue(rest, "--source");
	if (sourceFlag !== undefined && sourceFlag !== "api" && sourceFlag !== "local") {
		return "role --source must be local or api.";
	}
	const source =
		sourceFlag === "api" || sourceFlag === "local" ? sourceFlag : roleName === "frontier" ? "api" : "local";
	if (roleName === "frontier" && source === "local") {
		return "Frontier stays on the API.";
	}
	const thinkingFlag = flagValue(rest, "--thinking");
	let thinking = roleName === "planning" || roleName === "frontier";
	if (thinkingFlag !== undefined) {
		if (thinkingFlag !== "on" && thinkingFlag !== "off") {
			return "role --thinking must be on or off.";
		}
		thinking = thinkingFlag === "on";
	}
	const assignment: RoleAssignment = { source, id, thinking };
	const current = readRuntimeConfigFile(path);
	writeRuntimeConfigFile(path, withRoleOverride(current, roleName as RuntimeRole, assignment));
	return `${status(agentDir, cwd, path)}\nThe next session reads this file. This session does not start llama.cpp.`;
}

function status(agentDir: string, cwd: string, path: string): string {
	const config = loadRuntimeConfig({ agentDir, cwd });
	const lines = [`mode ${config.hierarchy.mode}`, `suite ${config.hierarchy.suite}`, `file ${path}`];
	for (const role of ["tooling", "workhorse", "planning", "frontier", "embedding", "reranker"] as const) {
		const assignment = config.roles[role];
		lines.push(assignment ? `${role} ${assignment.source} ${assignment.id}` : `${role} unset`);
	}
	return lines.join("\n");
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
		return args[index + 1];
	}
	return undefined;
}
