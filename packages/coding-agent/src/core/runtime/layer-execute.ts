/**
 * Run a bundled layer-* Archon workflow.
 * Independent Archon waves use cpa-agents mapPar. A shared agent session passes serialize
 * and stays sequential (one model must not prompt twice at once).
 * Parent blocks until one LayerSubtaskResult (join: layer_join) or HALT.
 */

import { runToolSchedule, type ScheduledCall } from "../algebra/process-schedule.ts";
import { type ArchonNode, type ArchonWorkflow, workflowWaves } from "../domains/archon.ts";
import {
	formatHandoffBrief,
	type HandoffBrief,
	LAYER_JOIN,
	type LayerSubtaskResult,
	type LayerSubtaskStatus,
	parseHandoffBriefFromText,
} from "./layer-decision.ts";
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
	/** Shared session agent: sequential Archon, no CPA. Isolated runners omit this. */
	serialize?: boolean;
}

export interface LayerExecuteResult {
	result: LayerSubtaskResult;
	schedulerUsed: boolean;
	seed: number;
}

export function layerWaves(workflow: ArchonWorkflow): ArchonNode[][] {
	return workflowWaves(workflow);
}

export type LayerContinueTarget = "planning" | "workhorse" | "restore" | "consult";

/** After mute nodes, which floor should own the rest of the turn. */
export function layerContinueTarget(workflow: string): LayerContinueTarget | undefined {
	switch (workflow) {
		case "layer-escalate":
		case "layer-hypotheses":
			return "planning";
		case "layer-descalate":
			return "workhorse";
		case "layer-consult":
			return "consult";
		default:
			return undefined;
	}
}

/** Catalog SKUs for a pinned role sequence (Workhorse → Planning → Frontier). */
export function handoffRoleIds(roles: Partial<Record<string, { id?: string }>>, sequence: readonly string[]): string[] {
	return sequence.map((role) => roles[role]?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function layerNodeRoles(workflow: { nodes: Array<{ kind: string; role?: string }> }): string[] {
	return workflow.nodes.filter((node) => node.kind === "prompt" && node.role).map((node) => node.role as string);
}

/** After mute handoff nodes, the parent turn must keep going with tools. */
export function layerContinuePrompt(input: {
	workflow: string;
	userTask: string;
	joinOutput: string;
	handoff?: HandoffBrief;
}): string | undefined {
	const target = layerContinueTarget(input.workflow);
	if (!target || target === "restore") {
		return undefined;
	}
	const task = input.userTask.trim();
	if (!task) {
		return undefined;
	}
	const lines = ["Continue the layering task.", "", "User turn:", task];
	if (input.handoff) {
		lines.push("", "Handoff brief:", formatHandoffBrief(input.handoff));
	} else if (input.joinOutput.trim()) {
		lines.push("", "Handoff:", input.joinOutput.trim());
	}
	if (target === "consult") {
		lines.push("", "Write the consult. Consult only. Do not edit files. Do not stay on Frontier after the answer.");
	} else if (target === "workhorse") {
		lines.push("", "Finish the named mechanical steps. Use tools. Do not stop after naming next steps.");
	} else {
		lines.push("", "Finish the remaining work. Use tools. Do not stop after naming next steps.");
	}
	return lines.join("\n");
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
		const batch = await runArchonCpaWave(wave, input);
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

async function runArchonCpaWave(
	wave: ArchonNode[],
	input: RunLayerWorkflowInput,
): Promise<{ values: LayerNodeReply[]; schedulerUsed: boolean }> {
	if (wave.length === 0) {
		return { values: [], schedulerUsed: false };
	}
	if (input.serialize || wave.length === 1) {
		const values: LayerNodeReply[] = [];
		for (const node of wave) {
			values.push(await input.runNode(node));
		}
		return { values, schedulerUsed: false };
	}
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
	return { values: batch.values, schedulerUsed: batch.schedulerUsed };
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
	const handoff =
		[...replies].reverse().find((reply) => reply.handoff)?.handoff ??
		parseHandoffBriefFromText(replies.find((reply) => reply.id === "handoff-brief")?.output ?? "");
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
