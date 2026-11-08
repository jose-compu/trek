/**
 * Call an Archon DAG the way Archon does.
 * A prompt node is one model step. A bash node is a shell step with no model.
 * `$USER_MESSAGE` and `$id.output` are substituted once, and the inserted text is not scanned again.
 * `when:` and `trigger_rule` skip nodes. `loop` iterates until `until` or max_iterations.
 * command and script still skip unless skipUncallable is false (then they throw).
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
import { evaluateWhen, type NodeRunStatus, shouldRunByTrigger } from "./archon-when.ts";

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
	/** When set, independent Archon waves run through cpa-agents `mapPar`. Omit on a shared agent session. */
	seed?: number;
	/** One shared model must not prompt in parallel. Sequential Archon, no CPA. */
	serialize?: boolean;
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
	if (options.seed !== undefined && !options.serialize) {
		return (await runArchonScheduled(workflow, options)).results;
	}
	const outputs = new Map<string, string>();
	const statuses = new Map<string, NodeRunStatus>();
	const results: WorkflowNodeResult[] = [];
	for (const node of orderNodes(workflow)) {
		const ran = await runOrSkip(workflow, node, options, outputs, statuses);
		results.push(ran);
	}
	return results;
}

export async function runArchonScheduled(
	workflow: ArchonWorkflow,
	options: RunArchonOptions,
): Promise<RunArchonScheduled> {
	const seed = options.seed ?? 0;
	const outputs = new Map<string, string>();
	const statuses = new Map<string, NodeRunStatus>();
	const results: WorkflowNodeResult[] = [];
	let schedulerUsed = false;
	for (const wave of workflowWaves(workflow)) {
		if (wave.length <= 1) {
			const node = wave[0];
			if (node) {
				results.push(await runOrSkip(workflow, node, options, outputs, statuses));
			}
			continue;
		}
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
				return runOrSkip(workflow, node, options, outputs, statuses);
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

async function runOrSkip(
	workflow: ArchonWorkflow,
	node: ArchonNode,
	options: RunArchonOptions,
	outputs: Map<string, string>,
	statuses: Map<string, NodeRunStatus>,
): Promise<WorkflowNodeResult> {
	const userMessage = options.userMessage ?? "";
	if (!shouldRunByTrigger(node.triggerRule, node.dependsOn, statuses)) {
		return skipNode(node, outputs, statuses);
	}
	try {
		if (!evaluateWhen(node.when, { userMessage, outputs })) {
			return skipNode(node, outputs, statuses);
		}
	} catch {
		statuses.set(node.id, "failed");
		outputs.set(node.id, "");
		return { id: node.id, output: "" };
	}
	noteNodeRole(node, options);
	try {
		const output = await runArchonNode(workflow, node, options, outputs);
		outputs.set(node.id, output);
		statuses.set(node.id, "ok");
		return { id: node.id, output };
	} catch (error) {
		if (options.skipUncallable && node.kind !== "prompt" && node.kind !== "bash" && node.kind !== "loop") {
			throw error;
		}
		statuses.set(node.id, "failed");
		outputs.set(node.id, "");
		throw error;
	}
}

function skipNode(
	node: ArchonNode,
	outputs: Map<string, string>,
	statuses: Map<string, NodeRunStatus>,
): WorkflowNodeResult {
	outputs.set(node.id, "(skipped)");
	statuses.set(node.id, "skipped");
	return { id: node.id, output: "(skipped)" };
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
			timeout: node.timeout ?? 10_000,
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
	if (!options.runPrompt) {
		if (options.skipUncallable) {
			return `loop ${node.id} skipped; no model`;
		}
		throw new Error(`loop node ${node.id} is an AI step and needs a model call`);
	}
	const until = node.loop?.until ?? "COMPLETE";
	const max = node.loop?.maxIterations ?? 1;
	let last = "";
	for (let iteration = 0; iteration < max; iteration++) {
		const prompt = renderPrompt(workflow, node, options.userMessage ?? "", outputs, options.facts ?? []);
		last = (
			await options.runPrompt(
				`${prompt}\n\nLoop iteration ${iteration + 1} of ${max}. Stop when the reply contains ${until}.`,
				node,
			)
		).trim();
		outputs.set(node.id, last);
		if (last.includes(until)) {
			break;
		}
	}
	return last;
}

function renderPrompt(
	workflow: ArchonWorkflow,
	node: ArchonNode,
	userMessage: string,
	outputs: Map<string, string>,
	facts: ReadonlyArray<{ name: string; value: string }>,
): string {
	const body = substitute(node.body, workflow, node.id, userMessage, outputs);
	const tools = node.allowedTools;
	const toolLine =
		tools && tools.length > 0
			? `You may use these tools: ${tools.join(", ")}.`
			: "Do not call a tool. Earlier replies are below.";
	const lines = [
		"Answer this step only.",
		"One line. No preamble.",
		toolLine,
		"If a fact is not in the user turn, the known facts, or an earlier reply, say it is not in the turn.",
		"",
		"User turn:",
		userMessage,
	];
	if (node.outputFormat) {
		lines.push("", "output_format:", JSON.stringify(node.outputFormat));
	}
	if (facts.length > 0) {
		lines.push("", "Known facts:");
		for (const fact of facts) {
			lines.push(`${fact.name}: ${fact.value}`);
		}
	}
	lines.push("", `Step ${node.id}:`, body);
	if (node.context !== "fresh") {
		for (const dep of node.dependsOn) {
			if (!node.body.includes(`$${dep}.output`)) {
				const reply = outputs.get(dep)?.trim();
				lines.push("", `$${dep}.output:`, reply && reply.length > 0 ? reply : "(none)");
			}
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
