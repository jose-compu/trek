/**
 * Execute layer-* via Archon waves. Independent waves use cpa-agents mapPar.
 * Run: npx vitest run test/suite/layering/layer-execute.test.ts --reporter=verbose
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ArchonNode } from "../../../src/core/domains/archon.ts";
import { parseArchonWorkflow } from "../../../src/core/domains/archon.ts";
import { applyAutoLayering, loadCatalogFixture } from "../../../src/core/runtime/catalog-map.ts";
import { LAYER_JOIN } from "../../../src/core/runtime/layer-decision.ts";
import {
	handoffRoleIds,
	type LayerNodeReply,
	layerContinuePrompt,
	layerContinueTarget,
	layerNodeRoles,
	layerWaves,
	runLayerWorkflow,
} from "../../../src/core/runtime/layer-execute.ts";
import { resolveRuntime } from "../../../src/core/runtime/resolve.ts";
import { defaultRuntimeConfig } from "../../../src/core/runtime/types.ts";

const meta = join(dirname(fileURLToPath(import.meta.url)), "../../../domains/meta");

function load(name: string) {
	return parseArchonWorkflow(readFileSync(join(meta, `${name}.yaml`), "utf8"));
}

function replies(map: Record<string, Partial<LayerNodeReply>>): (node: ArchonNode) => Promise<LayerNodeReply> {
	return async (node) => {
		const extra = map[node.id] ?? {};
		return {
			id: node.id,
			output: extra.output ?? node.id,
			evidence: extra.evidence ?? [node.id],
			status: extra.status ?? "ok",
			...(extra.winner ? { winner: extra.winner } : {}),
			...(extra.handoff ? { handoff: extra.handoff } : {}),
		};
	};
}

describe("layer execute", () => {
	it("runs independent tool-runner nodes through cpa-agents in overlapping time", async () => {
		const workflow = load("layer-tool-runners");
		expect(layerWaves(workflow)).toHaveLength(1);
		expect(layerWaves(workflow)[0]?.map((node) => node.id)).toEqual(["search", "logs", "fetch", "summarize"]);
		const delay = 80;
		const started: string[] = [];
		const ran: string[] = [];
		const t0 = performance.now();
		const executed = await runLayerWorkflow({
			workflow,
			layering: "auto",
			seed: 7,
			runNode: async (node) => {
				started.push(`start ${node.id}`);
				await new Promise((resolve) => {
					setTimeout(resolve, delay);
				});
				ran.push(node.id);
				started.push(`end ${node.id}`);
				return { id: node.id, output: node.id, evidence: [node.id], status: "ok" };
			},
		});
		const elapsed = performance.now() - t0;
		console.log("archon tool-runners ms", Math.round(elapsed), started.join(","));
		expect(executed.schedulerUsed).toBe(true);
		expect(executed.result.join).toBe(LAYER_JOIN);
		expect(executed.result.status).toBe("ok");
		expect(ran.sort()).toEqual(["fetch", "logs", "search", "summarize"]);
		expect(started[0]).toMatch(/^start /);
		expect(started[1]).toMatch(/^start /);
		expect(elapsed).toBeLessThan(delay * 2.5);
		expect(executed.result.evidence[0]).toBe("seed 7");
	});

	it("does not start CPA on a shared session (serialize)", async () => {
		const executed = await runLayerWorkflow({
			workflow: load("layer-tool-runners"),
			layering: "auto",
			seed: 7,
			serialize: true,
			runNode: async (node) => ({ id: node.id, output: node.id, status: "ok" }),
		});
		expect(executed.schedulerUsed).toBe(false);
		expect(executed.result.status).toBe("ok");
	});

	it("does not start CPA when layering is single", async () => {
		let calls = 0;
		const executed = await runLayerWorkflow({
			workflow: load("layer-tool-runners"),
			layering: "single",
			seed: 1,
			runNode: async (node) => {
				calls += 1;
				return { id: node.id, output: "no", status: "ok" };
			},
		});
		expect(calls).toBe(0);
		expect(executed.schedulerUsed).toBe(false);
		expect(executed.result.output).toMatch(/cpa skipped/);
	});

	it("does not start CPA when Kimi Swarm is on", async () => {
		let calls = 0;
		const executed = await runLayerWorkflow({
			workflow: load("layer-hypotheses"),
			layering: "auto",
			seed: 2,
			kimiSwarm: true,
			runNode: async (node) => {
				calls += 1;
				return { id: node.id, output: "no", status: "ok" };
			},
		});
		expect(calls).toBe(0);
		expect(executed.result.output).toMatch(/kimi swarm xor/);
	});

	it("joins hypotheses as winner-only", async () => {
		const executed = await runLayerWorkflow({
			workflow: load("layer-hypotheses"),
			layering: "manual",
			seed: 3,
			runNode: replies({
				"spawn-theories": { output: "A B C" },
				gather: { output: "evidence for B" },
				pick: { output: "theory B", winner: "theory-b", evidence: ["repro"] },
			}),
		});
		expect(executed.result.status).toBe("ok");
		expect(executed.result.winner).toBe("theory-b");
		expect(executed.result.output).toBe("theory B");
		expect(executed.result.evidence).toContain("repro");
		expect(executed.result.evidence).not.toContain("spawn-theories");
	});

	it("exits consult after the exit node", async () => {
		const ran: string[] = [];
		const executed = await runLayerWorkflow({
			workflow: load("layer-consult"),
			layering: "auto",
			seed: 4,
			runNode: async (node) => {
				ran.push(node.id);
				return {
					id: node.id,
					output: node.id,
					status: "ok",
					handoff:
						node.id === "handoff-brief"
							? {
									goal: "find leak",
									constraints: "no rewrite",
									tried: "two patches",
									evidence: ["log:1"],
									openQuestion: "which handle?",
								}
							: undefined,
				};
			},
		});
		expect(ran).toEqual(["handoff-brief", "diagnose", "exit"]);
		expect(executed.result.handoff?.goal).toBe("find leak");
		expect(executed.result.join).toBe(LAYER_JOIN);
	});

	it("hands descalate named steps back to Workhorse", async () => {
		const executed = await runLayerWorkflow({
			workflow: load("layer-descalate"),
			layering: "auto",
			seed: 5,
			runNode: replies({
				"named-steps": { output: "1. fix typo\n2. run lint" },
				"workhorse-act": { output: "handed to workhorse" },
			}),
		});
		expect(executed.result.output).toBe("1. fix typo\n2. run lint");
		expect(executed.result.status).toBe("ok");
	});

	it("joins partial fail when some runners fail", async () => {
		const executed = await runLayerWorkflow({
			workflow: load("layer-tool-runners"),
			layering: "auto",
			seed: 6,
			runNode: replies({
				logs: { status: "fail", output: "no logs" },
			}),
		});
		expect(executed.result.status).toBe("partial");
	});

	it("halts the parent when a node returns halt", async () => {
		const ran: string[] = [];
		const executed = await runLayerWorkflow({
			workflow: load("layer-hypotheses"),
			layering: "auto",
			seed: 8,
			runNode: async (node) => {
				ran.push(node.id);
				return {
					id: node.id,
					output: node.id === "spawn-theories" ? "budget" : node.id,
					status: node.id === "spawn-theories" ? "halt" : "ok",
				};
			},
		});
		expect(ran).toEqual(["spawn-theories"]);
		expect(executed.result.status).toBe("halt");
		expect(executed.result.output).toBe("budget");
		expect(executed.result.join).toBe(LAYER_JOIN);
	});

	it("overlaps the three hypothesis branches in one Archon wave", async () => {
		const delay = 80;
		const started: string[] = [];
		const t0 = performance.now();
		const executed = await runLayerWorkflow({
			workflow: load("layer-hypotheses"),
			layering: "auto",
			seed: 12,
			runNode: async (node) => {
				if (node.id.startsWith("theory-")) {
					started.push(`start ${node.id}`);
					await new Promise((resolve) => {
						setTimeout(resolve, delay);
					});
					started.push(`end ${node.id}`);
				}
				return {
					id: node.id,
					output: node.id === "pick" ? "theory B" : node.id,
					status: "ok",
					...(node.id === "pick" ? { winner: "theory-b" } : {}),
				};
			},
		});
		const elapsed = performance.now() - t0;
		console.log("archon hypotheses theories ms", Math.round(elapsed), started.join(","));
		expect(executed.schedulerUsed).toBe(true);
		expect(executed.result.winner).toBe("theory-b");
		expect(started.filter((row) => row.startsWith("start ")).sort()).toEqual([
			"start theory-a",
			"start theory-b",
			"start theory-c",
		]);
		expect(started[0]).toMatch(/^start /);
		expect(started[1]).toMatch(/^start /);
		expect(elapsed).toBeLessThan(delay * 2.5);
	});

	it("finishes a parallel wave on halt, then skips later waves", async () => {
		const ran: string[] = [];
		const executed = await runLayerWorkflow({
			workflow: load("layer-tool-runners"),
			layering: "auto",
			seed: 9,
			runNode: async (node) => {
				ran.push(node.id);
				return {
					id: node.id,
					output: node.id,
					status: node.id === "logs" ? "halt" : "ok",
				};
			},
		});
		expect(ran.sort()).toEqual(["fetch", "logs", "search", "summarize"]);
		expect(executed.result.status).toBe("halt");
		expect(executed.result.evidence).toContain("seed 9");
	});

	it("keeps hypotheses winner output but marks partial if a prior node failed", async () => {
		const executed = await runLayerWorkflow({
			workflow: load("layer-hypotheses"),
			layering: "auto",
			seed: 10,
			runNode: replies({
				gather: { status: "fail", output: "no logs" },
				pick: { output: "theory B", winner: "theory-b" },
			}),
		});
		expect(executed.result.winner).toBe("theory-b");
		expect(executed.result.output).toBe("theory B");
		expect(executed.result.status).toBe("partial");
	});

	it("continues layer-escalate after mute handoff nodes so Workhorse/Planning can finish", () => {
		const follow = layerContinuePrompt({
			workflow: "layer-escalate",
			userTask: "Debug the race. Escalate to planning with a handoff.",
			joinOutput: "Workhorse next: write hypotheses then one failing repro.",
		});
		expect(follow).toMatch(/^Continue the layering task\./);
		expect(follow).toMatch(/Use tools/);
		expect(follow).toMatch(/hypotheses then one failing repro/);
		expect(
			layerContinuePrompt({ workflow: "layer-tool-runners", userTask: "grep the log", joinOutput: "ok" }),
		).toBeUndefined();
		expect(layerContinueTarget("layer-consult")).toBe("consult");
		expect(
			layerContinuePrompt({
				workflow: "layer-consult",
				userTask: "consult frontier. Architect a migration. Consult only.",
				joinOutput: "consult result",
			}),
		).toMatch(/Consult only/);
		expect(layerContinueTarget("layer-descalate")).toBe("workhorse");
	});

	it("pins escalate/descalate/consult/hypotheses roles and maps them to Grok SKUs", () => {
		expect(layerNodeRoles(load("layer-escalate"))).toEqual(["workhorse", "planning", "planning"]);
		expect(layerNodeRoles(load("layer-descalate"))).toEqual(["planning", "planning", "workhorse"]);
		expect(layerNodeRoles(load("layer-consult"))).toEqual(["workhorse", "frontier", "frontier"]);
		expect(layerNodeRoles(load("layer-hypotheses"))).toEqual([
			"workhorse",
			"workhorse",
			"workhorse",
			"workhorse",
			"tooling",
			"planning",
		]);
		expect(layerWaves(load("layer-hypotheses")).map((wave) => wave.map((node) => node.id))).toEqual([
			["spawn-theories"],
			["theory-a", "theory-b", "theory-c"],
			["gather"],
			["pick"],
		]);
		const catalogs = join(dirname(fileURLToPath(import.meta.url)), "fixtures/catalogs");
		const grok = resolveRuntime(
			applyAutoLayering(defaultRuntimeConfig(), loadCatalogFixture(join(catalogs, "xai.json"))),
		);
		expect(handoffRoleIds(grok.roles, ["workhorse", "planning", "frontier"])).toEqual([
			"grok-4.3",
			"grok-4.5",
			"grok-4.20-multi-agent",
		]);
		expect(handoffRoleIds(grok.roles, layerNodeRoles(load("layer-escalate")))).toEqual([
			"grok-4.3",
			"grok-4.5",
			"grok-4.5",
		]);
	});

	it("parses a labeled handoff-brief reply into the five-field brief on join", async () => {
		const executed = await runLayerWorkflow({
			workflow: load("layer-escalate"),
			layering: "auto",
			seed: 11,
			runNode: async (node) => ({
				id: node.id,
				output:
					node.id === "handoff-brief"
						? "goal: debug concurrent-queue race; constraints: plan then one repro; tried: same edit failed twice; evidence: writers corrupt shared map; open: root cause still unclear."
						: node.id,
				status: "ok",
			}),
		});
		expect(executed.result.handoff).toMatchObject({
			goal: "debug concurrent-queue race",
			tried: "same edit failed twice",
			openQuestion: "root cause still unclear.",
		});
		expect(
			layerContinuePrompt({
				workflow: "layer-escalate",
				userTask: "Debug the race.",
				joinOutput: executed.result.output,
				handoff: executed.result.handoff,
			}),
		).toMatch(/Handoff brief:/);
	});
});
