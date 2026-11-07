/**
 * Run a bundled layer-* Archon workflow through cpa-agents.
 * Parent blocks until one LayerSubtaskResult (join: layer_join) or HALT.
 */

import { runToolSchedule, type ScheduledCall } from "../algebra/process-schedule.ts";
import { type ArchonNode, type ArchonWorkflow, orderNodes } from "../domains/archon.ts";
import { LAYER_JOIN, type LayerSubtaskResult, type LayerSubtaskStatus } from "./layer-decision.ts";
import type { LayeringMode } from "./types.ts";

export interface LayerNodeReply {
	id: string;
	output: string;
	evidence?: string[];
	status?: LayerSubtaskStatus;
	winner?: string;
	handoff?: LayerSubtaskResult["handoff"];
}

export interface RunLayerWorkflowInput {
	workflow: ArchonWorkflow;
	layering: LayeringMode;
	seed: number;
	/** Kimi Swarm on ⇒ Trek CPA runners off (one orchestrator). */
	kimiSwarm?: boolean;
	runNode: (node: ArchonNode) => Promise<LayerNodeReply>;
}

export interface LayerExecuteResult {
	result: LayerSubtaskResult;
	schedulerUsed: boolean;
	seed: number;
}

export function layerWaves(workflow: ArchonWorkflow): ArchonNode[][] {
	orderNodes(workflow);
	const remaining = new Map(workflow.nodes.map((node) => [node.id, new Set(node.dependsOn)]));
	const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
	const index = new Map(workflow.nodes.map((node, position) => [node.id, position]));
	const waves: ArchonNode[][] = [];
	while (remaining.size > 0) {
		const ready = [...remaining.entries()]
			.filter(([, deps]) => deps.size === 0)
			.map(([id]) => byId.get(id))
			.filter((node): node is ArchonNode => Boolean(node))
			.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
		if (ready.length === 0) {
			throw new Error("workflow has a cycle");
		}
		waves.push(ready);
		for (const node of ready) {
			remaining.delete(node.id);
		}
		for (const deps of remaining.values()) {
			for (const node of ready) {
				deps.delete(node.id);
			}
		}
	}
	return waves;
}

export async function runLayerWorkflow(input: RunLayerWorkflowInput): Promise<LayerExecuteResult> {
	const skipped = skipCpa(input);
	if (skipped) {
		return skipped;
	}
	const waves = layerWaves(input.workflow);
	const replies: LayerNodeReply[] = [];
	let schedulerUsed = false;
	for (const wave of waves) {
		const scheduled: ScheduledCall[] = wave.map((node) => ({
			id: node.id,
			name: node.id,
			args: {},
		}));
		const byId = new Map(wave.map((node) => [node.id, node]));
		const batch = await runToolSchedule({
			seed: input.seed,
			calls: scheduled,
			run: async (call) => {
				const node = byId.get(call.id);
				if (!node) {
					throw new Error(`missing node ${call.id}`);
				}
				return input.runNode(node);
			},
		});
		schedulerUsed = schedulerUsed || batch.schedulerUsed;
		for (const reply of batch.values) {
			replies.push({ ...reply, status: reply.status ?? "ok" });
		}
		// Halt joins after this CPA wave. Later waves do not start.
		if (replies.some((reply) => reply.status === "halt")) {
			return {
				result: joinResult(input.workflow.name, input.seed, replies),
				schedulerUsed,
				seed: input.seed,
			};
		}
		if (input.workflow.name === "layer-consult" && wave.some((node) => node.id === "exit")) {
			break;
		}
	}
	return {
		result: joinResult(input.workflow.name, input.seed, replies),
		schedulerUsed,
		seed: input.seed,
	};
}

function skipCpa(input: RunLayerWorkflowInput): LayerExecuteResult | undefined {
	if (input.layering === "single") {
		return {
			result: {
				join: LAYER_JOIN,
				status: "ok",
				workflow: input.workflow.name,
				output: "layering single; cpa skipped",
				evidence: [`seed ${input.seed}`],
			},
			schedulerUsed: false,
			seed: input.seed,
		};
	}
	if (input.kimiSwarm) {
		return {
			result: {
				join: LAYER_JOIN,
				status: "ok",
				workflow: input.workflow.name,
				output: "kimi swarm xor; cpa skipped",
				evidence: [`seed ${input.seed}`],
			},
			schedulerUsed: false,
			seed: input.seed,
		};
	}
	return undefined;
}

function joinResult(workflow: string, seed: number, replies: LayerNodeReply[]): LayerSubtaskResult {
	const halted = replies.find((reply) => reply.status === "halt");
	if (halted) {
		return {
			join: LAYER_JOIN,
			status: "halt",
			workflow,
			output: halted.output || "halt",
			evidence: evidenceOf(seed, replies),
		};
	}
	const winnerReply = replies.find((reply) => reply.winner);
	const selected =
		workflow === "layer-hypotheses" && winnerReply
			? [winnerReply]
			: workflow === "layer-descalate"
				? replies.filter(
						(reply) => reply.id === "named-steps" || reply.id === "workhorse-act" || reply.id === "handoff-brief",
					)
				: replies;
	const failed = replies.filter((reply) => reply.status === "fail").length;
	const status: LayerSubtaskStatus = failed === 0 ? "ok" : failed === replies.length ? "fail" : "partial";
	const output =
		workflow === "layer-hypotheses" && winnerReply
			? winnerReply.output
			: workflow === "layer-descalate"
				? (replies.find((reply) => reply.id === "named-steps")?.output ??
					selected.map((reply) => reply.output).join("\n"))
				: selected
						.map((reply) => reply.output)
						.filter(Boolean)
						.join("\n");
	const result: LayerSubtaskResult = {
		join: LAYER_JOIN,
		status,
		workflow,
		output,
		evidence: evidenceOf(seed, selected),
	};
	if (winnerReply?.winner) {
		result.winner = winnerReply.winner;
	}
	const handoff = [...replies].reverse().find((reply) => reply.handoff)?.handoff;
	if (handoff) {
		result.handoff = handoff;
	}
	return result;
}

function evidenceOf(seed: number, replies: LayerNodeReply[]): string[] {
	const items = [`seed ${seed}`];
	for (const reply of replies) {
		for (const item of reply.evidence ?? []) {
			items.push(item);
		}
	}
	return items.slice(0, 8);
}
