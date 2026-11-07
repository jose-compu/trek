/**
 * Execute layer-* via Archon + cpa-agents. Mocked node replies; no live APIs.
 * Run: npx vitest run test/suite/layering/layer-execute.test.ts --reporter=verbose
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ArchonNode } from "../../../src/core/domains/archon.ts";
import { parseArchonWorkflow } from "../../../src/core/domains/archon.ts";
import { LAYER_JOIN } from "../../../src/core/runtime/layer-decision.ts";
import { type LayerNodeReply, layerWaves, runLayerWorkflow } from "../../../src/core/runtime/layer-execute.ts";

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
	it("runs independent tool-runner nodes through cpa-agents", async () => {
		const workflow = load("layer-tool-runners");
		expect(layerWaves(workflow)).toHaveLength(1);
		expect(layerWaves(workflow)[0]?.map((node) => node.id)).toEqual(["search", "logs", "fetch", "summarize"]);
		const ran: string[] = [];
		const executed = await runLayerWorkflow({
			workflow,
			layering: "auto",
			seed: 7,
			runNode: async (node) => {
				ran.push(node.id);
				return { id: node.id, output: node.id, evidence: [node.id], status: "ok" };
			},
		});
		expect(executed.schedulerUsed).toBe(true);
		expect(executed.result.join).toBe(LAYER_JOIN);
		expect(executed.result.status).toBe("ok");
		expect(ran.sort()).toEqual(["fetch", "logs", "search", "summarize"]);
		expect(executed.result.evidence[0]).toBe("seed 7");
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
		const executed = await runLayerWorkflow({
			workflow: load("layer-hypotheses"),
			layering: "auto",
			seed: 8,
			runNode: replies({
				"spawn-theories": { status: "halt", output: "budget" },
			}),
		});
		expect(executed.result.status).toBe("halt");
		expect(executed.result.output).toBe("budget");
		expect(executed.result.join).toBe(LAYER_JOIN);
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
});
