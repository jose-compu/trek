/**
 * Breadth-first branches. Each branch is a child agent with the parent summary only.
 * Branches run in parallel. A file written by one branch is claimed for that spawn.
 */

import { resolveToCwd } from "../tools/path-utils.ts";

export const MAX_BREADTH = 4;

export interface BranchInput {
	description: string;
	summary?: string;
}

export interface BranchTask {
	id: string;
	description: string;
	summary: string;
}

export interface BranchResult {
	id: string;
	description: string;
	summary: string;
	isError: boolean;
}

export function planBranches(subtasks: readonly BranchInput[], nextId: () => string): BranchTask[] {
	if (subtasks.length === 0) {
		throw new Error("spawn_branches needs at least one subtask.");
	}
	if (subtasks.length > MAX_BREADTH) {
		throw new Error(`Branch breadth limit (${MAX_BREADTH}) exceeded: ${subtasks.length} subtasks.`);
	}
	return subtasks.map((subtask) => {
		const description = subtask.description.trim();
		if (!description) throw new Error("A branch subtask needs a description.");
		return { id: nextId(), description, summary: subtask.summary?.trim() || description };
	});
}

export function branchPrompt(task: BranchTask, count: number): string {
	return [
		`You are branch ${task.id}, one of ${count} parallel branches.`,
		`Parent summary: ${task.summary}`,
		`Task: ${task.description}`,
		"Do only this task. End with a short summary of what you found or changed.",
	].join("\n");
}

/** Path a write or edit call mutates, resolved against cwd. */
export function mutatedPath(toolName: string, args: unknown, cwd: string): string | undefined {
	if (toolName !== "write" && toolName !== "edit") return undefined;
	const record = (args ?? {}) as { path?: unknown; file_path?: unknown };
	const raw = typeof record.path === "string" ? record.path : record.file_path;
	if (typeof raw !== "string" || !raw) return undefined;
	try {
		return resolveToCwd(raw, cwd);
	} catch {
		return undefined;
	}
}

export class FileClaims {
	private readonly owners = new Map<string, string>();

	/** Returns the other owner when the path is already claimed. */
	claim(path: string, branchId: string): { owner?: string; created: boolean } {
		const owner = this.owners.get(path);
		if (owner && owner !== branchId) return { owner, created: false };
		if (owner) return { created: false };
		this.owners.set(path, branchId);
		return { created: true };
	}

	release(path: string, branchId: string): void {
		if (this.owners.get(path) === branchId) this.owners.delete(path);
	}
}

/** Runs one task at a time, in call order. */
export class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const next = this.tail.then(task, task);
		this.tail = next.catch(() => undefined);
		return next;
	}
}

export function formatBranchResults(results: readonly BranchResult[]): string {
	return results
		.map((result) => `${result.id}${result.isError ? " (error)" : ""}: ${result.description}\n${result.summary}`)
		.join("\n\n");
}

export function gatherBranches(store: ReadonlyMap<string, BranchResult>, ids: readonly string[]): string {
	const missing = ids.filter((id) => !store.has(id));
	if (missing.length > 0) {
		throw new Error(`unknown branch ${missing.join(", ")}`);
	}
	return formatBranchResults(ids.map((id) => store.get(id) as BranchResult));
}
