/**
 * trek models — 0.8.0 Runtime (issue #89).
 */

import chalk from "chalk";
import { APP_NAME, getAgentDir } from "./config.ts";
import {
	benchmarkRuntime,
	defaultRuntimeConfig,
	formatBenchmark,
	formatRuntimeStatus,
	globalModelsYamlPath,
	isHierarchyMode,
	isRuntimeRole,
	isSuiteId,
	loadRuntimeConfig,
	type RoleAssignment,
	type RoleSource,
	readRuntimeConfigFile,
	resolveRuntime,
	withHierarchy,
	withRoleOverride,
	writeRuntimeConfigFile,
} from "./core/runtime/index.ts";

function printHelp(): void {
	console.log(`${APP_NAME} models list`);
	console.log(`${APP_NAME} models set-mode api|local|hybrid`);
	console.log(`${APP_NAME} models set-suite mistral|mistral-pro|qwen|lfm`);
	console.log(`${APP_NAME} models set-role <role> --id <id> [--source local|api] [--thinking on|off]`);
	console.log(`${APP_NAME} models benchmark`);
	console.log("  Role registry in ~/.trek/models.yaml. Project .trek/models.yaml overrides it.");
	console.log("  Default mode is api: no llama.cpp process. Local and hybrid are opt-in.");
	console.log("  This command does not download weights (0.16.0).");
	console.log("  --provider and --model still choose the session model in api mode.");
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
		return args[index + 1];
	}
	return undefined;
}

export async function handleModelsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "models") {
		return false;
	}
	const rest = args.slice(1);
	if (rest.length === 0 || rest.includes("--help") || rest.includes("-h") || rest[0] === "list") {
		if (rest.includes("--help") || rest.includes("-h")) {
			printHelp();
			return true;
		}
		printStatus();
		return true;
	}

	const sub = rest[0];
	if (sub === "set-mode") {
		return setMode(rest.slice(1));
	}
	if (sub === "set-suite") {
		return setSuite(rest.slice(1));
	}
	if (sub === "set-role") {
		return setRole(rest.slice(1));
	}
	if (sub === "benchmark") {
		return benchmark();
	}

	console.error(chalk.red(`Unknown models command ${sub ?? ""}.`));
	printHelp();
	process.exitCode = 1;
	return true;
}

function printStatus(): void {
	const config = loadRuntimeConfig({ agentDir: getAgentDir(), cwd: process.cwd() });
	console.log(formatRuntimeStatus(resolveRuntime(config)));
	console.log("");
	console.log(`global: ${globalModelsYamlPath(getAgentDir())}`);
}

function loadGlobal(): ReturnType<typeof readRuntimeConfigFile> {
	const path = globalModelsYamlPath(getAgentDir());
	try {
		return readRuntimeConfigFile(path);
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return defaultRuntimeConfig();
	}
}

function setMode(rest: string[]): boolean {
	const mode = rest[0];
	if (!mode || !isHierarchyMode(mode)) {
		console.error(chalk.red("Usage: trek models set-mode api|local|hybrid"));
		process.exitCode = 1;
		return true;
	}
	const current = loadGlobal();
	if (process.exitCode) {
		return true;
	}
	writeRuntimeConfigFile(globalModelsYamlPath(getAgentDir()), withHierarchy(current, { mode }));
	printStatus();
	return true;
}

function setSuite(rest: string[]): boolean {
	const suite = rest[0];
	if (!suite || !isSuiteId(suite)) {
		console.error(chalk.red("Usage: trek models set-suite mistral|mistral-pro|qwen|lfm"));
		process.exitCode = 1;
		return true;
	}
	const current = loadGlobal();
	if (process.exitCode) {
		return true;
	}
	writeRuntimeConfigFile(globalModelsYamlPath(getAgentDir()), withHierarchy(current, { suite }));
	printStatus();
	return true;
}

function setRole(rest: string[]): boolean {
	const roleName = rest[0];
	if (!roleName || !isRuntimeRole(roleName)) {
		console.error(
			chalk.red("Usage: trek models set-role <tooling|workhorse|planning|frontier|embedding|reranker> --id <id>"),
		);
		process.exitCode = 1;
		return true;
	}
	const id = flagValue(rest, "--id");
	if (!id) {
		console.error(chalk.red("set-role requires --id."));
		process.exitCode = 1;
		return true;
	}
	const sourceFlag = flagValue(rest, "--source");
	const source: RoleSource =
		sourceFlag === "api" || sourceFlag === "local" ? sourceFlag : roleName === "frontier" ? "api" : "local";
	if (sourceFlag !== undefined && sourceFlag !== "api" && sourceFlag !== "local") {
		console.error(chalk.red("set-role --source must be local or api."));
		process.exitCode = 1;
		return true;
	}
	const thinkingFlag = flagValue(rest, "--thinking");
	let thinking = roleName === "planning" || roleName === "frontier";
	if (thinkingFlag !== undefined) {
		if (thinkingFlag !== "on" && thinkingFlag !== "off") {
			console.error(chalk.red("set-role --thinking must be on or off."));
			process.exitCode = 1;
			return true;
		}
		thinking = thinkingFlag === "on";
	}
	const assignment: RoleAssignment = { source, id, thinking };
	const provider = flagValue(rest, "--provider");
	if (provider) {
		assignment.provider = provider;
	}
	const repo = flagValue(rest, "--repo");
	if (repo) {
		assignment.repo = repo;
	}
	try {
		const current = loadGlobal();
		if (process.exitCode) {
			return true;
		}
		writeRuntimeConfigFile(globalModelsYamlPath(getAgentDir()), withRoleOverride(current, roleName, assignment));
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
	printStatus();
	return true;
}

function benchmark(): boolean {
	const config = loadRuntimeConfig({ agentDir: getAgentDir(), cwd: process.cwd() });
	const resolved = resolveRuntime(config);
	const rows = benchmarkRuntime(resolved, {
		weightsAvailable: () => false,
	});
	console.log(formatBenchmark(rows));
	return true;
}
