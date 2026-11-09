#!/usr/bin/env node

/**
 * Pre-commit test planner: run only workspaces whose source or reverse-deps
 * are in the staged set. Docs-only commits skip. Root lockfile / test runner
 * changes run the full suite. TREK_FULL_TEST=1 forces the full suite.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Workspace dir under packages/ → npm -w name. Order is run order. */
export const WORKSPACES = [
	{ dir: "tui", name: "@trek/tui", runner: "node-test" },
	{ dir: "ai", name: "@trek/ai", runner: "vitest" },
	{ dir: "agent", name: "@trek/agent-core", runner: "vitest" },
	{ dir: "coding-agent", name: "@trek/coding-agent", runner: "vitest" },
];

/** If this package’s source changes, also retest these packages. */
export const DEPENDENTS = {
	tui: ["coding-agent"],
	ai: ["agent", "coding-agent"],
	agent: ["coding-agent"],
	"coding-agent": [],
};

const SKIP_RE = /\.(md|mdx)$/i;
const TEST_RE = /\.(?:test|spec)\.(?:ts|js|mjs|cjs)$/;
const WIDE_RE = /(?:^|\/)(?:package\.json|package-lock\.json|vitest(?:\.\w+)?\.config\.ts|tsconfig[^/]*\.json)$/;

function isSkipFile(file) {
	if (SKIP_RE.test(file)) {
		return true;
	}
	if (file.startsWith(".github/") || file === "LICENSE" || file.startsWith("LICENSE.")) {
		return true;
	}
	return false;
}

function isFullTrigger(file) {
	if (file === "package.json" || file === "package-lock.json" || file === "test.sh") {
		return true;
	}
	if (file.startsWith(".husky/")) {
		return true;
	}
	if (/^(?:biome\.jsonc?|tsconfig(?:\.\w+)?\.json)$/.test(file)) {
		return true;
	}
	if (file.startsWith("scripts/") && !file.startsWith("scripts/affected-tests")) {
		return true;
	}
	return false;
}

function isSelfTestFile(file) {
	return file === "scripts/affected-tests.mjs" || file === "scripts/affected-tests.test.mjs";
}

function workspaceOf(file) {
	const match = /^packages\/([^/]+)\//.exec(file);
	if (!match) {
		return undefined;
	}
	return WORKSPACES.find((item) => item.dir === match[1]);
}

function isTestFile(file) {
	return TEST_RE.test(file);
}

export function expandDependents(dirs) {
	const out = new Set(dirs);
	let grew = true;
	while (grew) {
		grew = false;
		for (const dir of [...out]) {
			for (const next of DEPENDENTS[dir] ?? []) {
				if (!out.has(next)) {
					out.add(next);
					grew = true;
				}
			}
		}
	}
	return WORKSPACES.map((item) => item.dir).filter((dir) => out.has(dir));
}

function relInPackage(file, dir) {
	return relative(`packages/${dir}`, file);
}

/**
 * @param {string[]} files
 * @returns {{
 *   kind: "skip" | "full" | "self" | "packages";
 *   reason: string;
 *   runs: Array<{ dir: string; name: string; mode: "all" | "files"; files: string[]; reason: string }>;
 * }}
 */
export function planAffectedTests(files) {
	const staged = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
	const code = staged.filter((file) => !isSkipFile(file));
	if (code.length === 0) {
		return { kind: "skip", reason: "docs only", runs: [] };
	}
	if (code.every(isSelfTestFile) && code.some((file) => file.endsWith(".mjs"))) {
		return { kind: "self", reason: "affected-tests planner", runs: [] };
	}
	if (code.some(isFullTrigger)) {
		const hit = code.find(isFullTrigger) ?? "root";
		return { kind: "full", reason: hit, runs: [] };
	}

	/** @type {Map<string, { source: string[]; tests: string[]; wide: boolean }>} */
	const direct = new Map();
	const unknown = [];
	for (const file of code) {
		const workspace = workspaceOf(file);
		if (!workspace) {
			unknown.push(file);
			continue;
		}
		const bucket = direct.get(workspace.dir) ?? { source: [], tests: [], wide: false };
		if (WIDE_RE.test(file)) {
			bucket.wide = true;
		} else if (isTestFile(file)) {
			bucket.tests.push(relInPackage(file, workspace.dir));
		} else {
			bucket.source.push(relInPackage(file, workspace.dir));
		}
		direct.set(workspace.dir, bucket);
	}
	if (unknown.length > 0 && direct.size === 0) {
		return { kind: "full", reason: unknown[0], runs: [] };
	}

	const affected = expandDependents([...direct.keys()]);
	const runs = [];
	for (const dir of affected) {
		const workspace = WORKSPACES.find((item) => item.dir === dir);
		if (!workspace) {
			continue;
		}
		const own = direct.get(dir);
		const forcedByDep = expandDependents([...direct.keys()].filter((item) => item !== dir)).includes(dir);
		if (!own || forcedByDep || own.wide || own.source.length > 0 || workspace.runner !== "vitest") {
			runs.push({
				dir,
				name: workspace.name,
				mode: "all",
				files: [],
				reason: !own ? "dependency" : forcedByDep ? "dependency" : own.wide ? "config" : "source",
			});
			continue;
		}
		runs.push({
			dir,
			name: workspace.name,
			mode: "files",
			files: own.tests,
			reason: "tests",
		});
	}
	if (runs.length === 0) {
		return { kind: "skip", reason: "docs only", runs: [] };
	}
	return { kind: "packages", reason: runs.map((run) => run.name).join(", "), runs };
}

function gitStagedFiles() {
	return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
		encoding: "utf8",
		cwd: ROOT,
	})
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function run(command, args, cwd = ROOT) {
	console.log(`$ ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
	return result;
}

function runWorkspace(runSpec) {
	const cwd = join(ROOT, "packages", runSpec.dir);
	const workspace = WORKSPACES.find((item) => item.dir === runSpec.dir);
	if (runSpec.mode === "files" && runSpec.files.length > 0) {
		run("npx", ["vitest", "--run", "--reporter=verbose", ...runSpec.files], cwd);
		return;
	}
	if (workspace?.runner === "vitest") {
		run("npm", ["test", "-w", runSpec.name, "--if-present", "--", "--reporter=verbose"]);
		return;
	}
	run("npm", ["test", "-w", runSpec.name, "--if-present"]);
}

function printPlan(plan) {
	if (plan.kind === "skip") {
		console.log(`Affected tests: skip (${plan.reason}).`);
		return;
	}
	if (plan.kind === "full") {
		console.log(`Affected tests: full suite (${plan.reason}).`);
		return;
	}
	if (plan.kind === "self") {
		console.log(`Affected tests: ${plan.reason}.`);
		return;
	}
	const parts = plan.runs.map((item) => {
		if (item.mode === "all") {
			return `${item.name} [${item.reason}]`;
		}
		return `${item.name} tests ${item.files.join(" ")}`;
	});
	console.log(`Affected tests: ${parts.join("; ")}`);
}

function main() {
	const argv = process.argv.slice(2);
	const printOnly = argv.includes("--print");
	const rest = argv.filter((arg) => arg !== "--print");
	if (process.env.TREK_FULL_TEST === "1" || process.env.TREK_FULL_TEST === "true") {
		const plan = { kind: "full", reason: "TREK_FULL_TEST", runs: [] };
		printPlan(plan);
		if (printOnly) {
			console.log(JSON.stringify(plan, null, "\t"));
			return;
		}
		run("npm", ["test"]);
		return;
	}
	const files =
		rest.length > 0
			? rest
			: process.env.TREK_AFFECTED_FILES
				? process.env.TREK_AFFECTED_FILES.split("\n")
				: gitStagedFiles();
	const plan = planAffectedTests(files);
	printPlan(plan);
	if (printOnly) {
		console.log(JSON.stringify(plan, null, "\t"));
		return;
	}
	if (plan.kind === "skip") {
		return;
	}
	if (plan.kind === "full") {
		run("npm", ["test"]);
		return;
	}
	if (plan.kind === "self") {
		run("node", ["--test", "scripts/affected-tests.test.mjs"]);
		return;
	}
	for (const item of plan.runs) {
		runWorkspace(item);
	}
}

const invoked = process.argv[1] ? fileURLToPath(pathToFileURL(resolve(process.argv[1]))) : "";
if (invoked && fileURLToPath(import.meta.url) === invoked) {
	main();
}
