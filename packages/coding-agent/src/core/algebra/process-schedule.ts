/**
 * Conflict-free tool schedule (0.10.0).
 * Four names are visible: parallel, sequence, guarded choice, inversion.
 * The rest of cpa-agents stays inside this module.
 */

import { ifThenElse, invertible, mapPar, type Process, type ProcessContext, Scheduler, seq } from "cpa-agents";
import { parseBashPathOps } from "../trek-store/path-ops.ts";

export const SCHEDULE_PATTERNS = ["parallel", "sequence", "guarded choice", "inversion"] as const;

export type SchedulePattern = (typeof SCHEDULE_PATTERNS)[number];

export interface ScheduledCall {
	id: string;
	name: string;
	args: unknown;
	/** When set, the call is a guarded choice and runs only if this is true. */
	when?: boolean;
}

export interface ProcessNode {
	pattern: SchedulePattern;
	seed: number;
	durationMs: number;
	label: string;
	toolCallId?: string;
	children: ProcessNode[];
}

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write"]);

const MUTATING_BASH =
	/(?:^|[\s;&|])(rm|mv|cp|tee|mkdir|rmdir|touch|truncate|unlink|install|ln)\b|\bsed\b[^\n]*(\s-i\b|--in-place)|[<>]/;

export function bashMutates(command: string): boolean {
	return MUTATING_BASH.test(command) || parseBashPathOps(command) !== null;
}

function callPath(args: unknown): string | undefined {
	if (!args || typeof args !== "object") {
		return undefined;
	}
	const record = args as { path?: unknown; file_path?: unknown };
	if (typeof record.path === "string" && record.path.length > 0) {
		return record.path;
	}
	if (typeof record.file_path === "string" && record.file_path.length > 0) {
		return record.file_path;
	}
	return undefined;
}

function bashCommand(args: unknown): string | undefined {
	if (!args || typeof args !== "object") {
		return undefined;
	}
	const command = (args as { command?: unknown }).command;
	return typeof command === "string" ? command : undefined;
}

type CallClass =
	| { kind: "read"; path?: string }
	| { kind: "write"; path: string }
	| { kind: "join" }
	| { kind: "barrier" };

export function classifyCall(call: ScheduledCall): CallClass {
	if (READ_TOOLS.has(call.name)) {
		return { kind: "read", path: call.name === "read" ? callPath(call.args) : undefined };
	}
	if (WRITE_TOOLS.has(call.name)) {
		return { kind: "write", path: callPath(call.args) ?? call.id };
	}
	if (call.name === "bash") {
		const command = bashCommand(call.args) ?? "";
		return bashMutates(command) ? { kind: "barrier" } : { kind: "join" };
	}
	return { kind: "join" };
}

function isMutation(call: ScheduledCall): boolean {
	const kind = classifyCall(call).kind;
	return kind === "write" || kind === "barrier";
}

/** Group a batch. One call is returned as a single group. Order inside a group is start order. */
export function planToolGroups(calls: readonly ScheduledCall[]): ScheduledCall[][] {
	const groups: ScheduledCall[][] = [];
	let open: ScheduledCall[] = [];
	const written = new Set<string>();

	const close = (): void => {
		if (open.length === 0) {
			return;
		}
		groups.push(open);
		open = [];
		written.clear();
	};

	for (const call of calls) {
		const classified = classifyCall(call);
		if (classified.kind === "barrier") {
			close();
			groups.push([call]);
			continue;
		}
		if (classified.kind === "write" && written.has(classified.path)) {
			close();
		}
		if (classified.kind === "read" && classified.path && written.has(classified.path)) {
			close();
		}
		open.push(call);
		if (classified.kind === "write") {
			written.add(classified.path);
		}
	}
	close();
	return groups;
}

function callLabel(call: ScheduledCall): string {
	const path = callPath(call.args);
	return path ? `${call.name} ${path}` : call.name;
}

/** One user prompt may contain several model turns. Each turn is one batch. */
export function composePromptTree(
	batches: readonly (readonly ScheduledCall[])[],
	seed: number,
): ProcessNode | undefined {
	const nodes = batches.filter((batch) => batch.length > 0).map((batch) => buildProcessTree(batch, seed));
	if (nodes.length === 0) {
		return undefined;
	}
	if (nodes.length === 1) {
		return nodes[0];
	}
	return {
		pattern: "sequence",
		seed,
		durationMs: 0,
		label: "",
		children: nodes,
	};
}

export function buildProcessTree(calls: readonly ScheduledCall[], seed: number): ProcessNode {
	const groups = planToolGroups(calls);
	const children = groups.map((group) => groupNode(group, seed));
	if (children.length === 1) {
		return children[0];
	}
	return {
		pattern: "sequence",
		seed,
		durationMs: 0,
		label: "",
		children,
	};
}

function groupNode(group: ScheduledCall[], seed: number): ProcessNode {
	const leaves = group.map((call) => leafNode(call, seed));
	if (leaves.length === 1) {
		return leaves[0];
	}
	return {
		pattern: "parallel",
		seed,
		durationMs: 0,
		label: "",
		children: leaves,
	};
}

function leafNode(call: ScheduledCall, seed: number): ProcessNode {
	const pattern: SchedulePattern =
		call.when !== undefined ? "guarded choice" : isMutation(call) ? "inversion" : "parallel";
	return {
		pattern,
		seed,
		durationMs: 0,
		label: callLabel(call),
		toolCallId: call.id,
		children: [],
	};
}

export function rollupDurations(node: ProcessNode): number {
	if (node.children.length === 0) {
		return node.durationMs;
	}
	const times = node.children.map((child) => rollupDurations(child));
	node.durationMs = node.pattern === "parallel" ? Math.max(...times) : times.reduce((sum, time) => sum + time, 0);
	return node.durationMs;
}

export function formatProcessTree(node: ProcessNode | undefined): string {
	if (!node) {
		return "No process tree for this prompt.";
	}
	const lines: string[] = [];
	const walk = (current: ProcessNode, depth: number): void => {
		const pad = "  ".repeat(depth);
		const label = current.label ? ` ${current.label}` : "";
		lines.push(`${pad}${current.pattern} ${current.durationMs}ms seed ${current.seed}${label}`);
		for (const child of current.children) {
			walk(child, depth + 1);
		}
	};
	walk(node, 0);
	return lines.join("\n");
}

/** Same seed, same open branch. */
export function guardedChoice<T>(
	seed: number,
	branches: ReadonlyArray<{ name: string; when: boolean; value: T }>,
): { name: string; value: T } | undefined {
	const open = branches.filter((branch) => branch.when);
	if (open.length === 0) {
		return undefined;
	}
	if (open.length === 1) {
		return open[0];
	}
	const index = Math.floor(mulberry32(seed) * open.length);
	return open[index];
}

function mulberry32(seed: number): number {
	let value = seed >>> 0;
	value = (value + 0x6d2b79f5) | 0;
	let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
	mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
	return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

export interface ToolScheduleResult<T> {
	values: T[];
	tree: ProcessNode;
	elapsedMs: number;
	schedulerUsed: boolean;
	revert: () => Promise<void>;
}

export async function runToolSchedule<T>(options: {
	seed: number;
	calls: readonly ScheduledCall[];
	run: (call: ScheduledCall) => Promise<T>;
	inverseFor?: (call: ScheduledCall) => (() => Promise<void>) | undefined;
	trek?: () => Promise<void>;
	git?: () => Promise<void>;
}): Promise<ToolScheduleResult<T>> {
	const tree = buildProcessTree(options.calls, options.seed);
	const undos: Array<() => Promise<void>> = [];
	const byId = new Map<string, T>();
	const started = performance.now();
	const run = async (call: ScheduledCall): Promise<T> => {
		const leafStarted = performance.now();
		const value = await options.run(call);
		const leaf = findLeaf(tree, call.id);
		if (leaf) {
			leaf.durationMs = elapsedSince(leafStarted);
		}
		byId.set(call.id, value);
		return value;
	};

	const revert = async (): Promise<void> => {
		for (const undo of [...undos].reverse()) {
			await undo();
		}
		if (options.trek) {
			await options.trek();
		}
		if (options.git) {
			await options.git();
		}
	};

	const orderedValues = (): T[] => options.calls.map((call) => byId.get(call.id) as T);

	if (options.calls.length <= 1) {
		const call = options.calls[0];
		if (call) {
			const inverse = options.inverseFor?.(call);
			if (inverse) {
				undos.push(inverse);
			}
			await run(call);
		}
		rollupDurations(tree);
		return { values: orderedValues(), tree, elapsedMs: elapsedSince(started), schedulerUsed: false, revert };
	}

	const groups = planToolGroups(options.calls);
	const nodes = tree.pattern === "sequence" ? tree.children : [tree];
	const processes = groups.map((group, index) =>
		timedProcess(nodes[index], () => groupProcess(group, run, options.inverseFor, undos)),
	);
	const root = processes.length === 1 ? processes[0] : seq(...processes);
	const scheduler = new Scheduler();
	const result = await scheduler.run(`seed-${options.seed}`, root);
	if (!result.success) {
		throw result.error;
	}
	rollupDurations(tree);
	return { values: orderedValues(), tree, elapsedMs: elapsedSince(started), schedulerUsed: true, revert };
}

function elapsedSince(started: number): number {
	return Math.max(0, Math.round(performance.now() - started));
}

export function noteToolDuration(node: ProcessNode, toolCallId: string, durationMs: number): void {
	const leaf = findLeaf(node, toolCallId);
	if (!leaf) {
		return;
	}
	leaf.durationMs = durationMs;
	rollupDurations(node);
}

function findLeaf(node: ProcessNode, id: string): ProcessNode | undefined {
	if (node.toolCallId === id) {
		return node;
	}
	for (const child of node.children) {
		const found = findLeaf(child, id);
		if (found) {
			return found;
		}
	}
	return undefined;
}

function timedProcess(node: ProcessNode | undefined, build: () => Process<void>): Process<void> {
	return async (ctx) => {
		const started = performance.now();
		await build()(ctx);
		if (node && node.children.length > 0) {
			node.durationMs = elapsedSince(started);
		}
	};
}

function groupProcess(
	group: readonly ScheduledCall[],
	run: (call: ScheduledCall) => Promise<unknown>,
	inverseFor: ((call: ScheduledCall) => (() => Promise<void>) | undefined) | undefined,
	undos: Array<() => Promise<void>>,
): Process<void> {
	const members = group.map((call) => memberProcess(call, run, inverseFor, undos));
	if (members.length === 1) {
		return members[0];
	}
	return async (ctx) => {
		await mapPar(group, (call) => memberProcess(call, run, inverseFor, undos), { failFast: false })(ctx);
	};
}

function memberProcess(
	call: ScheduledCall,
	run: (call: ScheduledCall) => Promise<unknown>,
	inverseFor: ((call: ScheduledCall) => (() => Promise<void>) | undefined) | undefined,
	undos: Array<() => Promise<void>>,
): Process<void> {
	const forward = async (): Promise<void> => {
		const inverse = inverseFor?.(call);
		if (inverse) {
			undos.push(inverse);
		}
		await run(call);
	};
	if (call.when !== undefined) {
		return ifThenElse(
			async () => call.when === true,
			async () => {
				await forward();
			},
			async () => undefined,
		);
	}
	const inverse = inverseFor?.(call);
	if (!inverse) {
		return async () => {
			await forward();
		};
	}
	return async (ctx: ProcessContext) => {
		const step = invertible(
			async () => {
				undos.push(inverse);
				await run(call);
			},
			() => async () => {
				await inverse();
			},
		);
		await step.forward(ctx);
	};
}

/** Inverse, then .trek history, then git. Each step is optional. */
export async function revertInOrder(steps: {
	inverse?: () => Promise<void>;
	trek?: () => Promise<void>;
	git?: () => Promise<void>;
}): Promise<void> {
	if (steps.inverse) {
		await steps.inverse();
	}
	if (steps.trek) {
		await steps.trek();
	}
	if (steps.git) {
		await steps.git();
	}
}
