/**
 * Call an Archon DAG the way Archon does.
 * A prompt node is one model step. A bash node is a shell step with no model.
 * `$USER_MESSAGE` and `$id.output` are substituted once, and the inserted text is not scanned again.
 * command, script, and loop parse as Archon. This release does not call them.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ArchonNode, type ArchonWorkflow, orderNodes } from "./archon.ts";

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
	/** Required for a prompt node. Archon calls the model once per node. */
	runPrompt?: (prompt: string, node: ArchonNode) => Promise<string>;
}

export async function runArchonWorkflow(
	workflow: ArchonWorkflow,
	cwdOrOptions: string | RunArchonOptions,
): Promise<WorkflowNodeResult[]> {
	const options: RunArchonOptions = typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : cwdOrOptions;
	const outputs = new Map<string, string>();
	const results: WorkflowNodeResult[] = [];
	for (const node of orderNodes(workflow)) {
		const output = await callNode(workflow, node, options, outputs);
		outputs.set(node.id, output);
		results.push({ id: node.id, output });
	}
	return results;
}

async function callNode(
	workflow: ArchonWorkflow,
	node: ArchonNode,
	options: RunArchonOptions,
	outputs: Map<string, string>,
): Promise<string> {
	if (node.kind === "prompt") {
		if (!options.runPrompt) {
			throw new Error(`prompt node ${node.id} is an AI step and needs a model call`);
		}
		const prompt = renderPrompt(workflow, node, options.userMessage ?? "", outputs);
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
		throw new Error(`command node ${node.id} names a command file. This release calls prompt and bash nodes.`);
	}
	if (node.kind === "script") {
		throw new Error(
			`script node ${node.id} is not called in this release. This release calls prompt and bash nodes.`,
		);
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
): string {
	const body = substitute(node.body, workflow, node.id, userMessage, outputs);
	const lines = [
		"Answer only this Archon node.",
		"If a fact is not in the user turn or an upstream output, say it is not in the turn.",
		"",
		"User turn:",
		userMessage,
		"",
		`Node ${node.id}:`,
		body,
	];
	for (const dep of node.dependsOn) {
		if (!node.body.includes(`$${dep}.output`)) {
			lines.push("", `$${dep}.output:`, outputs.get(dep) ?? "");
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
