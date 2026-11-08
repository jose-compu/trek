/**
 * Static Archon YAML + subtask join into Trek. No live APIs.
 * Run: npx vitest run test/suite/layering/archon-subtasks.test.ts --reporter=verbose
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workflowWaves } from "../../../src/core/domains/archon.ts";
import { findLayerWorkflow, loadDomainCatalog, loadLayerWorkflows } from "../../../src/core/domains/catalog.ts";
import { attachLayerWorkflow, skipLayerArchon } from "../../../src/core/domains/layer-compose.ts";
import { runArchonWorkflow } from "../../../src/core/domains/run.ts";
import { selectDomain } from "../../../src/core/domains/select.ts";
import {
	applyAutoLayering,
	classifyTask,
	defaultRuntimeConfig,
	layerContinueTarget,
	layerDecisionTextFromEnvelope,
	layerWaves,
	loadCatalogFixture,
	parseHandoffBriefFromText,
	parseLayerDecision,
	parseLayerSubtaskResult,
	runLayerWorkflow,
	selectSessionRole,
} from "../../../src/core/runtime/index.ts";
import { resolveRuntime } from "../../../src/core/runtime/resolve.ts";
import { loadLayeringCase } from "./load-fixture.ts";

const catalogs = join(dirname(fileURLToPath(import.meta.url)), "fixtures/catalogs");

const LAYER_WAVES: Record<string, string[][]> = {
	"layer-escalate": [["handoff-brief"], ["plan"], ["steps-back"]],
	"layer-descalate": [["handoff-brief"], ["named-steps"], ["workhorse-act"]],
	"layer-consult": [["handoff-brief"], ["diagnose"], ["exit"]],
	"layer-hypotheses": [["spawn-theories"], ["theory-a", "theory-b", "theory-c"], ["gather"], ["pick"]],
	"layer-tool-runners": [["search", "logs", "fetch", "summarize"]],
	"layer-route": [["classify"], ["script", "workhorse"]],
	"layer-verify": [["read-diff"], ["verdict"]],
	"layer-draft-review": [["draft"], ["review-diff"]],
	"layer-scripts": [["command"], ["bash"]],
};

const COMPOSE_PACKS = [
	["openai", "workhorse", "hypotheses-compose"],
	["openai", "workhorse", "consult-compose"],
	["openai", "workhorse", "descalate-compose"],
	["openai", "workhorse", "finance-control-none"],
	["openai", "workhorse", "defect-fix-escalate"],
] as const;

const XAI_SUBTASK_PACKS = [
	["planning", "hypotheses-fanout"],
	["workhorse", "handoff-brief-join"],
	["tooling", "parallel-runners"],
] as const;

describe("Archon workflows as Trek fixtures", () => {
	it("parses all fourteen layer-* files with the expected waves", () => {
		const workflows = loadLayerWorkflows();
		expect(workflows).toHaveLength(14);
		for (const workflow of workflows) {
			expect(findLayerWorkflow(workflow.name)?.name).toBe(workflow.name);
			const expected = LAYER_WAVES[workflow.name];
			if (!expected) {
				expect(workflow.nodes.length).toBeGreaterThan(0);
				continue;
			}
			expect(
				workflowWaves(workflow).map((wave) => wave.map((node) => node.id)),
				workflow.name,
			).toEqual(expected);
		}
	});

	it("keeps every domain DAG a prompt-only Archon file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-archon-domains-"));
		const catalog = loadDomainCatalog(cwd);
		expect(catalog.domains).toHaveLength(20);
		for (const domain of catalog.domains) {
			expect(
				domain.workflow.nodes.every((node) => node.kind === "prompt"),
				domain.id,
			).toBe(true);
			expect(domain.nodeIds).toEqual(domain.workflow.nodes.map((node) => node.id));
		}
	});
});

describe("static compose packs", () => {
	const cwd = mkdtempSync(join(tmpdir(), "trek-archon-compose-"));
	const catalog = loadDomainCatalog(cwd);

	for (const [dialect, role, pack] of COMPOSE_PACKS) {
		it(`${dialect}/${role}/${pack} selects domain and layer-*`, () => {
			const loaded = loadLayeringCase(dialect, role, pack);
			const prompt = loaded.prompt.trim();
			const selection = attachLayerWorkflow(selectDomain(catalog, { task: prompt }), "auto", prompt);
			expect(selection.workflow).toBe(loaded.expect.workflow);
			expect(selection.layer_workflow).toBe(loaded.expect.layer_workflow);
			if (loaded.expect.domain) {
				expect(selection.domain).toBe(loaded.expect.domain);
			}
			const parsed = parseLayerDecision(layerDecisionTextFromEnvelope(dialect, loaded.response));
			expect(parsed.action).toBe(loaded.expect.action);
			expect(parsed.target).toBe(loaded.expect.target);
			if (loaded.expect.continueTarget) {
				expect(layerContinueTarget(String(loaded.expect.layer_workflow))).toBe(loaded.expect.continueTarget);
			}
			expect(attachLayerWorkflow(selection, "single", prompt).layer_workflow).toBe("none");
		});
	}
});

describe("xAI subtask envelopes", () => {
	const cwd = mkdtempSync(join(tmpdir(), "trek-archon-xai-"));
	const catalog = loadDomainCatalog(cwd);
	const layered = resolveRuntime(
		applyAutoLayering(defaultRuntimeConfig(), loadCatalogFixture(join(catalogs, "xai.json"))),
	);

	for (const [role, pack] of XAI_SUBTASK_PACKS) {
		it(`xai/${role}/${pack}`, () => {
			const loaded = loadLayeringCase("xai", role, pack);
			const prompt = loaded.prompt.trim();
			const text = layerDecisionTextFromEnvelope("xai", loaded.response);
			const selection = attachLayerWorkflow(selectDomain(catalog, { task: prompt }), "auto", prompt);
			const selected = selectSessionRole({ text: prompt, resolved: layered });
			expect(classifyTask(prompt).kind, prompt).toBe(loaded.expect.kind);
			expect(selected.role, prompt).toBe(loaded.expect.startRole);
			expect(selected.modelId).toBe(loaded.expect.boundId);
			expect(selection.workflow).toBe(loaded.expect.workflow);
			expect(selection.layer_workflow).toBe(loaded.expect.layer_workflow);
			expect(skipLayerArchon({ layerWorkflow: selection.layer_workflow, task: prompt })).toBe(
				Boolean(loaded.expect.skipLayerArchon),
			);
			if (loaded.expect.join) {
				const subtask = parseLayerSubtaskResult(text);
				expect(subtask.join).toBe(loaded.expect.join);
				expect(subtask.workflow).toBe(loaded.expect.layer_workflow);
				if (loaded.expect.winner) {
					expect(subtask.winner).toBe(loaded.expect.winner);
				}
			}
			if (loaded.expect.handoffGoal) {
				expect(parseHandoffBriefFromText(text)?.goal).toBe(loaded.expect.handoffGoal);
			}
			if (loaded.expect.continueTarget) {
				expect(layerContinueTarget(selection.layer_workflow)).toBe(loaded.expect.continueTarget);
			}
		});
	}
});

describe("canned Archon × subtask runs", () => {
	const cwd = mkdtempSync(join(tmpdir(), "trek-archon-run-"));
	const catalog = loadDomainCatalog(cwd);

	it("runs defect-fix then layer-escalate and joins a handoff brief", async () => {
		const task = loadLayeringCase("xai", "workhorse", "handoff-brief-join").prompt.trim();
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const layer = findLayerWorkflow("layer-escalate");
		expect(coding?.workflowName).toBe("defect-fix");
		expect(layer?.name).toBe("layer-escalate");
		const domainResults = await runArchonWorkflow(coding!.workflow, {
			cwd,
			userMessage: task,
			runPrompt: async (_prompt, node) => {
				if (node.id === "reproduce") {
					return "lint error in src/foo.ts";
				}
				if (node.id === "locate") {
					return "line 12";
				}
				if (node.id === "smallest-change") {
					return "fix the type";
				}
				return "run the typecheck";
			},
		});
		expect(domainResults.map((row) => row.id)).toEqual(["reproduce", "locate", "smallest-change", "verify"]);
		const executed = await runLayerWorkflow({
			workflow: layer!,
			layering: "auto",
			seed: 11,
			runNode: async (node) => ({
				id: node.id,
				output:
					node.id === "handoff-brief"
						? "goal: fix lint in src/foo.ts; constraints: smallest change; tried: two edits; evidence: line 12; open: which check."
						: node.id,
				status: "ok",
			}),
		});
		expect(executed.schedulerUsed).toBe(false);
		expect(executed.result.join).toBe("layer_join");
		expect(executed.result.handoff?.goal).toBe("fix lint in src/foo.ts");
		expect(layerContinueTarget("layer-escalate")).toBe("planning");
	});

	it("fans out three hypothesis subtasks then Planning picks", async () => {
		const layer = findLayerWorkflow("layer-hypotheses");
		expect(layerWaves(layer!).map((wave) => wave.map((node) => node.id))).toEqual(LAYER_WAVES["layer-hypotheses"]);
		const ran: string[] = [];
		const executed = await runLayerWorkflow({
			workflow: layer!,
			layering: "auto",
			seed: 12,
			runNode: async (node) => {
				ran.push(node.id);
				return {
					id: node.id,
					output: node.id === "pick" ? "theory B" : node.id,
					status: "ok",
					...(node.id === "pick" ? { winner: "theory-b", evidence: ["repro under load"] } : {}),
				};
			},
		});
		expect(ran).toEqual(["spawn-theories", "theory-a", "theory-b", "theory-c", "gather", "pick"]);
		expect(executed.schedulerUsed).toBe(true);
		expect(executed.result.winner).toBe("theory-b");
		expect(executed.result.output).toBe("theory B");
		expect(executed.result.evidence).toContain("repro under load");
		const packed = parseLayerSubtaskResult(
			layerDecisionTextFromEnvelope("xai", loadLayeringCase("xai", "planning", "hypotheses-fanout").response),
		);
		expect(packed.winner).toBe("theory-b");
		expect(packed.workflow).toBe("layer-hypotheses");
	});

	it("skips the script branch of bundled layer-route from a static classify reply", async () => {
		const layer = findLayerWorkflow("layer-route");
		const results = await runArchonWorkflow(layer!, {
			cwd,
			userMessage: "route to scripts or workhorse: fix the lint",
			runPrompt: async (_prompt, node) => {
				if (node.id === "classify") {
					return JSON.stringify({
						action: "continue",
						target: "workhorse",
						confidence: "high",
						reason: "lint fix",
						evidence: ["src/foo.ts"],
					});
				}
				return node.id;
			},
		});
		expect(results).toEqual([
			{
				id: "classify",
				output: JSON.stringify({
					action: "continue",
					target: "workhorse",
					confidence: "high",
					reason: "lint fix",
					evidence: ["src/foo.ts"],
				}),
			},
			{ id: "script", output: "(skipped)" },
			{ id: "workhorse", output: "workhorse" },
		]);
	});

	it("does not mute Tooling with layer-tool-runners Archon nodes", () => {
		const pack = loadLayeringCase("xai", "tooling", "parallel-runners");
		expect(
			skipLayerArchon({
				layerWorkflow: "layer-tool-runners",
				role: "tooling",
				task: pack.prompt.trim(),
			}),
		).toBe(true);
		expect(skipLayerArchon({ layerWorkflow: "layer-escalate", role: "workhorse", task: pack.prompt.trim() })).toBe(
			false,
		);
	});
});
