/**
 * 0.18-A: domain DAG × layer-* on the same turn.
 * Run: npx vitest run test/suite/layering/layer-compose.test.ts --reporter=verbose
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeChatRole, parseArchonWorkflow, workflowWaves } from "../../../src/core/domains/archon.ts";
import { loadDomainCatalog } from "../../../src/core/domains/catalog.ts";
import {
	attachLayerWorkflow,
	selectLayerWorkflow,
	toolingWorkflowView,
} from "../../../src/core/domains/layer-compose.ts";
import { checkWorkflowNodes } from "../../../src/core/domains/node-check.ts";
import { runArchonScheduled } from "../../../src/core/domains/run.ts";
import { selectDomain } from "../../../src/core/domains/select.ts";
import { runDomainSessionCommand } from "../../../src/core/domains/session-command.ts";
import { layerDecisionTextFromEnvelope, parseLayerDecision } from "../../../src/core/runtime/index.ts";
import { buildTraceCycleV1 } from "../../../src/core/trace/schema.ts";
import { loadLayeringCase } from "./load-fixture.ts";

const phases = {
	observe: { phase: "observe" as const, summary: "o" },
	intend: { phase: "intend" as const, summary: "i" },
	act: { phase: "act" as const, summary: "a" },
	reflect: { phase: "reflect" as const, summary: "r" },
};

describe("domain × layer compose", () => {
	const task = "The lint error is in src/foo.ts. Escalate to planning with a handoff.";

	it("pairs defect-fix with layer-escalate when layered", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-compose-"));
		const selection = attachLayerWorkflow(selectDomain(loadDomainCatalog(cwd), { task }), "auto", task);
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("defect-fix");
		expect(selection.layer_workflow).toBe("layer-escalate");
		const trace = buildTraceCycleV1({
			cycleNumber: 1,
			startedAt: "2026-11-07T00:00:00.000Z",
			endedAt: "2026-11-07T00:00:01.000Z",
			phaseTimestamps: {},
			depth: 0,
			taskPreview: task,
			phases,
			components: [],
			domain: selection.domain,
			workflow: selection.workflow,
			layer_workflow: selection.layer_workflow,
		});
		expect(trace.workflow).toBe("defect-fix");
		expect(trace.layer_workflow).toBe("layer-escalate");
	});

	it("keeps layer_workflow none on single (0.12)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-compose-single-"));
		const selection = attachLayerWorkflow(selectDomain(loadDomainCatalog(cwd), { task }), "single", task);
		expect(selection.workflow).toBe("defect-fix");
		expect(selection.layer_workflow).toBe("none");
		expect(selectLayerWorkflow("single", task)).toBe("none");
		const pack = loadLayeringCase("openai", "workhorse", "single-vs-layered");
		expect(pack.expect.layer_workflow).toBe("none");
		expect(pack.expect.layering).toBe("single");
	});

	it("parses optional role on prompt nodes; bash/command do not bind a chat role", () => {
		const workflow = parseArchonWorkflow(`
name: pin-roles
description: Prompt may pin a role. Bash stays scripts.
nodes:
  - id: plan
    role: planning
    prompt: |
      Write a short plan.
  - id: act
    prompt: |
      Edit the file.
  - id: fmt
    bash: |
      echo format
`);
		expect(workflow.nodes[0]?.role).toBe("planning");
		expect(nodeChatRole(workflow.nodes[0]!, "workhorse")).toBe("planning");
		expect(nodeChatRole(workflow.nodes[1]!, "workhorse")).toBe("workhorse");
		expect(nodeChatRole(workflow.nodes[2]!, "workhorse")).toBeUndefined();
		expect(() =>
			parseArchonWorkflow(`
name: bad-bash-role
description: Bash cannot pin a model.
nodes:
  - id: fmt
    role: tooling
    bash: echo hi
`),
		).toThrow(/role is only valid on prompt nodes/);
	});

	it("schedules independent domain nodes through cpa-agents", async () => {
		const workflow = parseArchonWorkflow(`
name: two-independent
description: Two prompt nodes with no depends_on.
nodes:
  - id: left
    prompt: |
      Name the left fact.
  - id: right
    prompt: |
      Name the right fact.
`);
		expect(workflowWaves(workflow)).toHaveLength(1);
		expect(workflowWaves(workflow)[0]?.map((node) => node.id)).toEqual(["left", "right"]);
		const executed = await runArchonScheduled(workflow, {
			cwd: mkdtempSync(join(tmpdir(), "trek-compose-cpa-")),
			seed: 7,
			runPrompt: async (_prompt, node) => `${node.id} ok`,
		});
		expect(executed.schedulerUsed).toBe(true);
		expect(executed.results.map((row) => row.id).sort()).toEqual(["left", "right"]);
	});

	it("does not excuse a skipped domain node because a layer-* node passed", () => {
		const findings = checkWorkflowNodes(task, [{ id: "reproduce", prompt: "Restate the lint error.", output: "" }]);
		expect(findings[0]?.kind).toBe("skipped");
		const layerOk = checkWorkflowNodes(task, [
			{
				id: "handoff-brief",
				prompt: "Fill goal, constraints, what was tried, evidence, and the open question.",
				output: "goal is the lint error in src/foo.ts. escalate to planning with a handoff.",
			},
		]);
		expect(layerOk).toEqual([]);
		expect(findings.length).toBeGreaterThan(0);
	});

	it("lets Tooling see the selected domain workflow, not layer-*", () => {
		const view = toolingWorkflowView({
			domain: "coding",
			workflow: "defect-fix",
			layer_workflow: "layer-escalate",
			selectionReason: "match",
			nodeIds: ["reproduce"],
			yaml: "",
			parameters: [],
		});
		expect(view).toEqual({ domain: "coding", workflow: "defect-fix" });
		expect(view.workflow.startsWith("layer-")).toBe(false);
	});

	it("lists domain workflows and layer-* as two families", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-compose-list-"));
		const listed = runDomainSessionCommand(cwd, "workflows", "");
		expect(listed).toContain("coding");
		expect(listed).toContain("layer workflows");
		expect(listed).toContain("layer-escalate");
		expect(runDomainSessionCommand(cwd, "domains", "")).not.toContain("layer-escalate");
	});

	it("loads the defect-fix + layer-escalate fixture pack", () => {
		const pack = loadLayeringCase("openai", "workhorse", "defect-fix-escalate");
		expect(pack.prompt).toMatch(/lint error/);
		expect(pack.prompt).toMatch(/Escalate/);
		expect(parseLayerDecision(layerDecisionTextFromEnvelope("openai", pack.response))).toMatchObject({
			action: "escalate",
			target: "planning",
		});
		expect(pack.expect.workflow).toBe("defect-fix");
		expect(pack.expect.layer_workflow).toBe("layer-escalate");
	});
});
