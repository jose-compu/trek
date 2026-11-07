/**
 * Bundled layer-* Archon workflows (issue #192). Parse only; do not execute.
 * Run: npx vitest run test/layer-workflows.test.ts --reporter=verbose
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArchonWorkflow } from "../src/core/domains/archon.ts";
import { loadLayerWorkflows } from "../src/core/domains/catalog.ts";
import { runDomainSessionCommand } from "../src/core/domains/session-command.ts";

const EXPECTED = [
	"layer-ask-human",
	"layer-budget-stop",
	"layer-consult",
	"layer-cooldown",
	"layer-descalate",
	"layer-draft-review",
	"layer-escalate",
	"layer-hypotheses",
	"layer-route",
	"layer-scripts",
	"layer-think-brief",
	"layer-tool-runners",
	"layer-topic-reset",
	"layer-verify",
] as const;

describe("layer-* Archon workflows", () => {
	it("parses fourteen bundled files and rejects SKILL.md", () => {
		const workflows = loadLayerWorkflows();
		expect(workflows.map((item) => item.name)).toEqual([...EXPECTED]);
		for (const workflow of workflows) {
			expect(workflow.description.trim().length).toBeGreaterThan(0);
			expect(workflow.nodes.length).toBeGreaterThan(0);
		}
		expect(
			workflows.find((item) => item.name === "layer-scripts")?.nodes.every((node) => node.kind !== "prompt"),
		).toBe(true);
		expect(
			workflows.find((item) => item.name === "layer-escalate")?.nodes.some((node) => node.id === "handoff-brief"),
		).toBe(true);
		expect(
			workflows
				.find((item) => item.name === "layer-tool-runners")
				?.nodes.every((node) => node.dependsOn.length === 0),
		).toBe(true);
		expect(() => parseArchonWorkflow("name: x\ndescription: y\nnodes: []\n", "SKILL.md")).toThrow(/SKILL.md/);
	});

	it("lists layer-* on /workflows and can show one", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-layer-wf-"));
		const listed = runDomainSessionCommand(cwd, "workflows", "");
		expect(listed).toContain("layer workflows");
		expect(listed).toContain("layer-route");
		expect(listed).toContain("layer-cooldown");
		expect(runDomainSessionCommand(cwd, "domains", "")).not.toContain("layer-route");
		const shown = runDomainSessionCommand(cwd, "workflows", "show layer-route");
		expect(shown).toContain("layer-route");
		expect(shown).toMatch(/│ classify\s+│/);
	});
});
