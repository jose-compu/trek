import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHierarchyCommand } from "../src/core/hierarchy-command.ts";
import { loadRuntimeConfig } from "../src/core/runtime/registry.ts";

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

	it("writes mode, suite, and one role, and the next load reads them", () => {
		const { agentDir, cwd } = isolated();
		expect(runHierarchyCommand(agentDir, cwd, "mode hybrid")).toContain("mode hybrid");
		expect(runHierarchyCommand(agentDir, cwd, "suite qwen")).toContain("suite qwen");
		const written = runHierarchyCommand(
			agentDir,
			cwd,
			"role workhorse --id Qwen3.5-4B --source local --thinking off",
		);
		expect(written).toContain("workhorse local Qwen3.5-4B");
		expect(written).toContain("The next session reads this file.");
		const loaded = loadRuntimeConfig({ agentDir, cwd });
		expect(loaded.hierarchy.mode).toBe("hybrid");
		expect(loaded.hierarchy.suite).toBe("qwen");
		expect(loaded.roles.workhorse).toEqual({ source: "local", id: "Qwen3.5-4B", thinking: false });
	});

	it("refuses a local frontier and leaves the file unchanged", () => {
		const { agentDir, cwd } = isolated();
		runHierarchyCommand(agentDir, cwd, "mode api");
		const before = loadRuntimeConfig({ agentDir, cwd });
		const refused = runHierarchyCommand(agentDir, cwd, "role frontier --id grok-4 --source local");
		expect(refused).toBe("Frontier stays on the API.");
		expect(loadRuntimeConfig({ agentDir, cwd }).roles.frontier).toEqual(before.roles.frontier);
	});
});
