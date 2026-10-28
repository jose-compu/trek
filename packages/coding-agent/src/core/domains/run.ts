/**
 * Run an Archon DAG. Prompt nodes return their text.
 * Bash nodes run on the host after a short refuse list.
 * command, script, and loop are valid Archon and are not executed in this release.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ArchonWorkflow, orderNodes } from "./archon.ts";

const execFileAsync = promisify(execFile);

const REFUSED_BASH = /\b(sudo|curl|wget|mkfs|nc|netcat)\b|\brm\s+-|git\s+push|chmod\s+777|\bdd\s+/i;

export interface WorkflowNodeResult {
	id: string;
	output: string;
}

export async function runArchonWorkflow(workflow: ArchonWorkflow, cwd: string): Promise<WorkflowNodeResult[]> {
	const results: WorkflowNodeResult[] = [];
	for (const node of orderNodes(workflow)) {
		if (node.kind === "prompt") {
			results.push({ id: node.id, output: node.body });
			continue;
		}
		if (node.kind === "bash") {
			if (REFUSED_BASH.test(node.body)) {
				throw new Error(`refused bash node ${node.id}`);
			}
			const { stdout } = await execFileAsync("bash", ["-c", node.body], {
				cwd,
				timeout: 10_000,
				maxBuffer: 1_000_000,
			});
			results.push({ id: node.id, output: String(stdout).trim() });
			continue;
		}
		throw new Error(`${node.kind} nodes are not executed in this release`);
	}
	return results;
}
