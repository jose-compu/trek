import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHierarchyCommand } from "../src/core/hierarchy-command.ts";
import { globalModelsYamlPath, loadRuntimeConfig } from "../src/core/runtime/registry.ts";
import { parseRoleThinking } from "../src/core/runtime/types.ts";

describe("/hierarchy", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function isolated(): { agentDir: string; cwd: string } {
		const root = mkdtempSync(join(tmpdir(), "trek-hierarchy-"));
		dirs.push(root);
		return { agentDir: join(root, "agent"), cwd: join(root, "project") };
	}

	it("defaults to layering single", () => {
		const { agentDir, cwd } = isolated();
		const status = runHierarchyCommand(agentDir, cwd, "");
		expect(status).toContain("layering single");
		expect(loadRuntimeConfig({ agentDir, cwd }).hierarchy.layering).toBe("single");
	});

	it("writes mode, suite, and one role, and the next load reads them", () => {
		const { agentDir, cwd } = isolated();
		expect(runHierarchyCommand(agentDir, cwd, "mode hybrid")).toContain("mode hybrid");
		expect(runHierarchyCommand(agentDir, cwd, "suite qwen")).toContain("suite qwen");
		const written = runHierarchyCommand(
			agentDir,
			cwd,
			"role workhorse --id Qwen3.5-4B --source local --thinking off",
		);
		expect(written).toContain("workhorse local Qwen3.5-4B thinking off");
		expect(written).toContain("layering manual");
		expect(written).toContain("The next session reads this file.");
		const loaded = loadRuntimeConfig({ agentDir, cwd });
		expect(loaded.hierarchy.mode).toBe("hybrid");
		expect(loaded.hierarchy.suite).toBe("qwen");
		expect(loaded.hierarchy.layering).toBe("manual");
		expect(loaded.roles.workhorse).toEqual({ source: "local", id: "Qwen3.5-4B", thinking: "off" });
	});

	it("can set Decision to the shared LFM d1 id on a non-LFM suite", () => {
		const { agentDir, cwd } = isolated();
		runHierarchyCommand(agentDir, cwd, "suite mistral");
		const written = runHierarchyCommand(
			agentDir,
			cwd,
			"role decision --id LiquidAI/d1-omni-600M --source local --thinking off",
		);
		expect(written).toContain("decision local LiquidAI/d1-omni-600M");
		expect(loadRuntimeConfig({ agentDir, cwd }).roles.decision).toEqual({
			source: "local",
			id: "LiquidAI/d1-omni-600M",
			thinking: "off",
		});
	});

	it("allows a local frontier and verifier, and --thinking brief", () => {
		const { agentDir, cwd } = isolated();
		const frontier = runHierarchyCommand(agentDir, cwd, "role frontier --id grok-4 --source local --thinking brief");
		expect(frontier).toContain("frontier local grok-4 thinking brief");
		expect(frontier).not.toContain("Frontier stays on the API.");
		const verifier = runHierarchyCommand(
			agentDir,
			cwd,
			"role verifier --id mistral-small --source api --thinking off",
		);
		expect(verifier).toContain("verifier api mistral-small thinking off");
		const loaded = loadRuntimeConfig({ agentDir, cwd });
		expect(loaded.roles.frontier).toEqual({ source: "local", id: "grok-4", thinking: "brief" });
		expect(loaded.roles.verifier).toEqual({ source: "api", id: "mistral-small", thinking: "off" });
	});

	it("single clears extra roles; auto sets layering auto", () => {
		const { agentDir, cwd } = isolated();
		runHierarchyCommand(agentDir, cwd, "role tooling --id Qwen3.5-0.8B --source local --thinking off");
		runHierarchyCommand(agentDir, cwd, "role planning --id Qwen3.5-9B --source local --thinking deep");
		runHierarchyCommand(agentDir, cwd, "role frontier --id grok-4 --source api --thinking deep");
		runHierarchyCommand(agentDir, cwd, "role verifier --id other --source api --thinking off");
		runHierarchyCommand(agentDir, cwd, "role workhorse --id Qwen3.5-4B --source local --thinking off");
		const flattened = runHierarchyCommand(agentDir, cwd, "single");
		expect(flattened).toContain("layering single");
		const after = loadRuntimeConfig({ agentDir, cwd });
		expect(after.hierarchy.layering).toBe("single");
		expect(after.roles.tooling).toBeUndefined();
		expect(after.roles.planning).toBeUndefined();
		expect(after.roles.frontier).toBeUndefined();
		expect(after.roles.verifier).toBeUndefined();
		expect(after.roles.workhorse?.id).toBe("Qwen3.5-4B");
		expect(runHierarchyCommand(agentDir, cwd, "auto")).toContain("layering auto");
		expect(loadRuntimeConfig({ agentDir, cwd }).hierarchy.layering).toBe("auto");
	});

	it("clears one role with --clear", () => {
		const { agentDir, cwd } = isolated();
		runHierarchyCommand(agentDir, cwd, "role verifier --id other --source api --thinking off");
		runHierarchyCommand(agentDir, cwd, "role verifier --clear");
		expect(loadRuntimeConfig({ agentDir, cwd }).roles.verifier).toBeUndefined();
	});

	it("reads legacy YAML thinking booleans", () => {
		const { agentDir, cwd } = isolated();
		const path = globalModelsYamlPath(agentDir);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			[
				"hierarchy:",
				"  mode: api",
				"  suite: mistral",
				"  layering: single",
				"roles:",
				"  planning:",
				"    source: api",
				"    id: claude-opus",
				"    thinking: true",
				"  workhorse:",
				"    source: local",
				"    id: Qwen3.5-4B",
				"    thinking: false",
				"",
			].join("\n"),
		);
		const loaded = loadRuntimeConfig({ agentDir, cwd });
		expect(loaded.roles.planning?.thinking).toBe("deep");
		expect(loaded.roles.workhorse?.thinking).toBe("off");
	});
});

describe("parseRoleThinking", () => {
	it("maps YAML booleans and the 0.18 names", () => {
		expect(parseRoleThinking(true)).toBe("deep");
		expect(parseRoleThinking(false)).toBe("off");
		expect(parseRoleThinking("on")).toBe("deep");
		expect(parseRoleThinking("off")).toBe("off");
		expect(parseRoleThinking("brief")).toBe("brief");
		expect(parseRoleThinking("deep")).toBe("deep");
		expect(parseRoleThinking("nope")).toBeUndefined();
	});
});
