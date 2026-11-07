/**
 * Call an Archon DAG the way Archon does.
 * A prompt node is one model step. A bash node is a shell step with no model.
 * `$USER_MESSAGE` and `$id.output` are substituted once, and the inserted text is not scanned again.
 * command, script, and loop parse as Archon. This release does not call them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runToolSchedule, type ScheduledCall } from "../algebra/process-schedule.ts";
import {
	type ArchonNode,
	type ArchonNodeRole,
	type ArchonWorkflow,
	nodeChatRole,
	orderNodes,
	workflowWaves,
} from "./archon.ts";

const execFileAsync = promisify(execFile);

const REFUSED_BASH = /\b(sudo|curl|wget|mkfs|nc|netcat)\b|\brm\s+-|git\s+push|chmod\s+777|\bdd\s+/i;
const TOKEN = /\$(USER_MESSAGE|[A-Za-z_][A-Za-z0-9_-]*)\.output\b|\$USER_MESSAGE\b/g;

export interface WorkflowNodeResult {
	id: string;
	output: string;
}

export interface RunArchonOptions {
	cwd: string;
	/** The user turn. Prompt nodes see it as `$USER_MESSAGE`. */
	userMessage?: string;
	/** Facts already taken from the turn. A node must not invent past these. */
	facts?: ReadonlyArray<{ name: string; value: string }>;
	/** Required for a prompt node. Archon calls the model once per node. */
	runPrompt?: (prompt: string, node: ArchonNode) => Promise<string>;
	/** When set, independent nodes schedule through cpa-agents. */
	seed?: number;
	/** Default chat role for prompt nodes without `role:`. */
	currentRole?: ArchonNodeRole;
	/** Called before each prompt node so the session can bind that role. */
	onNodeRole?: (role: ArchonNodeRole | undefined, node: ArchonNode) => void;
	/** Layer-* command/script/loop nodes skip instead of failing the turn. */
	skipUncallable?: boolean;
}

export interface RunArchonScheduled {
	results: WorkflowNodeResult[];
	schedulerUsed: boolean;
}

export async function runArchonWorkflow(
	workflow: ArchonWorkflow,
	cwdOrOptions: string | RunArchonOptions,
): Promise<WorkflowNodeResult[]> {
	const options: RunArchonOptions = typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : cwdOrOptions;
	if (options.seed !== undefined) {
		return (await runArchonScheduled(workflow, options)).results;
	}
	const outputs = new Map<string, string>();
	const results: WorkflowNodeResult[] = [];
	for (const node of orderNodes(workflow)) {
		noteNodeRole(node, options);
		const output = await runArchonNode(workflow, node, options, outputs);
		outputs.set(node.id, output);
		results.push({ id: node.id, output });
	}
	return results;
}

export async function runArchonScheduled(
	workflow: ArchonWorkflow,
	options: RunArchonOptions,
): Promise<RunArchonScheduled> {
	const seed = options.seed ?? 0;
	const outputs = new Map<string, string>();
	const results: WorkflowNodeResult[] = [];
	let schedulerUsed = false;
	let promptGate: Promise<void> = Promise.resolve();
	for (const wave of workflowWaves(workflow)) {
		const scheduled: ScheduledCall[] = wave.map((node) => ({
			id: node.id,
			name: node.id,
			args: {},
		}));
		const byId = new Map(wave.map((node) => [node.id, node]));
		const batch = await runToolSchedule({
			seed,
			calls: scheduled,
			run: async (call) => {
				const node = byId.get(call.id);
				if (!node) {
					throw new Error(`missing node ${call.id}`);
				}
				const previous = promptGate;
				let release: () => void = () => {};
				promptGate = new Promise<void>((resolve) => {
					release = resolve;
				});
				await previous;
				try {
					noteNodeRole(node, options);
					const output = await runArchonNode(workflow, node, options, outputs);
					outputs.set(node.id, output);
					return { id: node.id, output };
				} finally {
					release();
				}
			},
		});
		schedulerUsed = schedulerUsed || batch.schedulerUsed;
		for (const reply of batch.values) {
			results.push(reply);
		}
	}
	return { results, schedulerUsed };
}

function noteNodeRole(node: ArchonNode, options: RunArchonOptions): void {
	options.onNodeRole?.(nodeChatRole(node, options.currentRole), node);
}

export async function runArchonNode(
	workflow: ArchonWorkflow,
	node: ArchonNode,
	options: RunArchonOptions,
	outputs: Map<string, string>,
): Promise<string> {
	if (node.kind === "prompt") {
		if (!options.runPrompt) {
			throw new Error(`prompt node ${node.id} is an AI step and needs a model call`);
		}
		const prompt = renderPrompt(workflow, node, options.userMessage ?? "", outputs, options.facts ?? []);
		return (await options.runPrompt(prompt, node)).trim();
	}
	if (node.kind === "bash") {
		const script = substitute(node.body, workflow, node.id, options.userMessage ?? "", outputs);
		if (REFUSED_BASH.test(script)) {
			throw new Error(`refused bash node ${node.id}`);
		}
		const { stdout } = await execFileAsync("bash", ["-c", script], {
			cwd: options.cwd,
			timeout: 10_000,
			maxBuffer: 1_000_000,
		});
		return String(stdout).trim();
	}
	if (node.kind === "command") {
		if (options.skipUncallable) {
			return `command ${node.body} skipped; no model`;
		}
		throw new Error(`command node ${node.id} names a command file. This release calls prompt and bash nodes.`);
	}
	if (node.kind === "script") {
		if (options.skipUncallable) {
			return `script ${node.id} skipped; no model`;
		}
		throw new Error(
			`script node ${node.id} is not called in this release. This release calls prompt and bash nodes.`,
		);
	}
	if (options.skipUncallable) {
		return `loop ${node.id} skipped; no model`;
	}
	throw new Error(
		`loop node ${node.id} repeats until ${node.loop?.until ?? "COMPLETE"}. This release calls prompt and bash nodes.`,
	);
}

function renderPrompt(
	workflow: ArchonWorkflow,
	node: ArchonNode,
	userMessage: string,
	outputs: Map<string, string>,
	facts: ReadonlyArray<{ name: string; value: string }>,
): string {
	const body = substitute(node.body, workflow, node.id, userMessage, outputs);
	const lines = [
		"Answer only this Archon node.",
		"One line. No preamble.",
		"Do not call a tool. The earlier node replies are below.",
		"If a fact is not in the user turn, the known facts, or an earlier reply, say it is not in the turn.",
		"",
		"User turn:",
		userMessage,
	];
	if (facts.length > 0) {
		lines.push("", "Known facts:");
		for (const fact of facts) {
			lines.push(`${fact.name}: ${fact.value}`);
		}
	}
	lines.push("", `Node ${node.id}:`, body);
	for (const dep of node.dependsOn) {
		if (!node.body.includes(`$${dep}.output`)) {
			const reply = outputs.get(dep)?.trim();
			lines.push("", `$${dep}.output:`, reply && reply.length > 0 ? reply : "(none)");
		}
	}
	return lines.join("\n");
}

/** One pass. A value inserted for a token is not scanned for further tokens. */
export function substitute(
	text: string,
	workflow: ArchonWorkflow,
	nodeId: string,
	userMessage: string,
	outputs: ReadonlyMap<string, string>,
): string {
	const ids = new Set(workflow.nodes.map((node) => node.id));
	return text.replace(TOKEN, (match, id: string | undefined) => {
		if (match === "$USER_MESSAGE") return userMessage;
		if (!id || !ids.has(id)) return match;
		if (!outputs.has(id)) {
			throw new Error(`node ${nodeId} reads $${id}.output before that node has completed`);
		}
		return outputs.get(id) ?? "";
	});
}
