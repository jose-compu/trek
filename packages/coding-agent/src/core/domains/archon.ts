/**
 * Archon workflow YAML (name, description, nodes).
 * A SKILL.md file is not a workflow.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { type ArchonTriggerRule, isArchonTriggerRule } from "./archon-when.ts";

export const ARCHON_NODE_KINDS = ["prompt", "command", "bash", "script", "loop"] as const;
export type ArchonNodeKind = (typeof ARCHON_NODE_KINDS)[number];

export const ARCHON_NODE_ROLES = ["workhorse", "planning", "frontier", "tooling"] as const;
export type ArchonNodeRole = (typeof ARCHON_NODE_ROLES)[number];

export const ARCHON_CONTEXTS = ["fresh", "shared"] as const;
export type ArchonContext = (typeof ARCHON_CONTEXTS)[number] | { resume: string };

export const ARCHON_EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type ArchonEffort = (typeof ARCHON_EFFORTS)[number];

export interface ArchonNode {
	id: string;
	kind: ArchonNodeKind;
	/** Prompt text, bash script, command name, or the loop prompt. */
	body: string;
	dependsOn: string[];
	/** Archon `allowed_tools`. An empty list means the node may not call tools. */
	allowedTools?: string[];
	/** Present when `kind` is `loop`. Archon stores this as an object, not a string. */
	loop?: { until: string; maxIterations: number };
	/** Prompt nodes only. Default is the current layer role. */
	role?: ArchonNodeRole;
	/** Archon `when:`. Skip the node when false. */
	when?: string;
	/** Archon `trigger_rule`. Default `all_success`. */
	triggerRule?: ArchonTriggerRule;
	/** Archon `context:` fresh | shared | { resume }. */
	context?: ArchonContext;
	/** Archon `skills:`. Exact skill names for this node. */
	skills?: string[];
	/** Archon `output_type`. Semantic label for `$id.output`. */
	outputType?: string;
	/** Archon `effort:` reasoning depth. */
	effort?: ArchonEffort;
	/** Archon `output_format` JSON Schema. */
	outputFormat?: Record<string, unknown>;
	/** Archon bash/script `timeout` in ms. */
	timeout?: number;
}

export interface ArchonWorkflow {
	name: string;
	description: string;
	nodes: ArchonNode[];
}

export function parseArchonWorkflow(text: string, sourcePath?: string): ArchonWorkflow {
	if (sourcePath?.endsWith("SKILL.md")) {
		throw new Error("SKILL.md is not a workflow");
	}
	const raw = parse(text);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("workflow must be a YAML object");
	}
	const record = raw as Record<string, unknown>;
	if (typeof record.name !== "string" || record.name.trim().length === 0) {
		throw new Error("workflow name is required");
	}
	if (typeof record.description !== "string" || record.description.trim().length === 0) {
		throw new Error("workflow description is required");
	}
	if (!Array.isArray(record.nodes) || record.nodes.length === 0) {
		throw new Error("workflow nodes are required");
	}
	const nodes = record.nodes.map((node, index) => parseNode(node, index));
	const ids = new Set<string>();
	for (const node of nodes) {
		if (ids.has(node.id)) {
			throw new Error(`duplicate node id ${node.id}`);
		}
		ids.add(node.id);
	}
	for (const node of nodes) {
		for (const dep of node.dependsOn) {
			if (!ids.has(dep)) {
				throw new Error(`node ${node.id} depends on unknown id ${dep}`);
			}
		}
	}
	orderNodes({ name: record.name.trim(), description: record.description.trim(), nodes });
	return {
		name: record.name.trim(),
		description: record.description.trim(),
		nodes,
	};
}

export function loadArchonFile(filePath: string): ArchonWorkflow {
	if (filePath.endsWith("SKILL.md")) {
		throw new Error("SKILL.md is not a workflow");
	}
	return parseArchonWorkflow(readFileSync(filePath, "utf8"), filePath);
}

function parseNode(value: unknown, index: number): ArchonNode {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`node ${index} must be an object`);
	}
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || record.id.trim().length === 0) {
		throw new Error(`node ${index} id is required`);
	}
	const id = record.id.trim();
	const present = presentKinds(record);
	if (present.length !== 1) {
		throw new Error(`node ${id} needs one of prompt, command, bash, script, or loop`);
	}
	const kind = present[0];
	const dependsOn = record.depends_on === undefined ? [] : stringList(record.depends_on, id);
	const allowedTools = readAllowedTools(record.allowed_tools, id);
	if (kind === "script" && record.runtime !== "bun" && record.runtime !== "uv") {
		throw new Error(`node ${id} script requires runtime bun or uv`);
	}
	const role = readNodeRole(record.role, id, kind);
	const extras = readNodeExtras(record, id, kind);
	if (kind === "loop") {
		const loop = readLoop(record.loop, id);
		return {
			id,
			kind,
			body: loop.prompt,
			dependsOn,
			allowedTools,
			loop: { until: loop.until, maxIterations: loop.maxIterations },
			...extras,
		};
	}
	return {
		id,
		kind,
		body: (record[kind] as string).trim(),
		dependsOn,
		allowedTools,
		...extras,
		...(role ? { role } : {}),
	};
}

function readNodeExtras(
	record: Record<string, unknown>,
	id: string,
	kind: ArchonNodeKind,
): Pick<
	ArchonNode,
	"when" | "triggerRule" | "context" | "skills" | "outputType" | "effort" | "outputFormat" | "timeout"
> {
	const extras: ReturnType<typeof readNodeExtras> = {};
	if (typeof record.when === "string" && record.when.trim().length > 0) {
		extras.when = record.when.trim();
	}
	if (record.trigger_rule !== undefined) {
		if (typeof record.trigger_rule !== "string" || !isArchonTriggerRule(record.trigger_rule)) {
			throw new Error(
				`node ${id} trigger_rule must be all_success, any_success, all_done, or none_failed_min_one_success`,
			);
		}
		extras.triggerRule = record.trigger_rule;
	}
	if (record.context !== undefined) {
		extras.context = readContext(record.context, id);
	}
	if (record.skills !== undefined) {
		extras.skills = stringListField(record.skills, id, "skills");
	}
	if (typeof record.output_type === "string" && record.output_type.trim().length === 0) {
		throw new Error(`node ${id} output_type must be a non-empty string`);
	}
	if (typeof record.output_type === "string") {
		extras.outputType = record.output_type.trim();
	}
	if (record.effort !== undefined) {
		if (typeof record.effort !== "string" || !ARCHON_EFFORTS.includes(record.effort as ArchonEffort)) {
			throw new Error(`node ${id} effort must be minimal, low, medium, or high`);
		}
		extras.effort = record.effort as ArchonEffort;
	}
	if (record.output_format !== undefined) {
		if (!record.output_format || typeof record.output_format !== "object" || Array.isArray(record.output_format)) {
			throw new Error(`node ${id} output_format must be a JSON Schema object`);
		}
		extras.outputFormat = record.output_format as Record<string, unknown>;
	}
	if (record.timeout !== undefined) {
		if (kind !== "bash" && kind !== "script") {
			throw new Error(`node ${id} timeout is only valid on bash or script nodes`);
		}
		if (typeof record.timeout !== "number" || !Number.isInteger(record.timeout) || record.timeout < 1) {
			throw new Error(`node ${id} timeout must be a positive integer (ms)`);
		}
		extras.timeout = record.timeout;
	}
	return extras;
}

function readContext(value: unknown, id: string): ArchonContext {
	if (value === "fresh" || value === "shared") {
		return value;
	}
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof (value as { resume?: unknown }).resume === "string"
	) {
		const resume = (value as { resume: string }).resume.trim();
		if (!resume) {
			throw new Error(`node ${id} context.resume is required`);
		}
		return { resume };
	}
	throw new Error(`node ${id} context must be fresh, shared, or { resume: node-id }`);
}

function readNodeRole(value: unknown, nodeId: string, kind: ArchonNodeKind): ArchonNodeRole | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || !isArchonNodeRole(value)) {
		throw new Error(`node ${nodeId} role must be workhorse, planning, frontier, or tooling`);
	}
	if (kind !== "prompt") {
		throw new Error(`node ${nodeId} role is only valid on prompt nodes`);
	}
	return value;
}

export function isArchonNodeRole(value: string): value is ArchonNodeRole {
	return (ARCHON_NODE_ROLES as readonly string[]).includes(value);
}

/** Prompt nodes follow the current role unless `role:` is set. Bash/command/script never bind a chat role. */
export function nodeChatRole(node: ArchonNode, currentRole?: ArchonNodeRole): ArchonNodeRole | undefined {
	if (node.kind !== "prompt") {
		return undefined;
	}
	return node.role ?? currentRole;
}

function presentKinds(record: Record<string, unknown>): ArchonNodeKind[] {
	const kinds: ArchonNodeKind[] = [];
	for (const kind of ARCHON_NODE_KINDS) {
		const value = record[kind];
		if (value === undefined) continue;
		if (kind === "loop") {
			kinds.push("loop");
			continue;
		}
		if (typeof value === "string" && value.trim().length > 0) {
			kinds.push(kind);
		}
	}
	return kinds;
}

function readLoop(value: unknown, nodeId: string): { prompt: string; until: string; maxIterations: number } {
	if (typeof value === "string") {
		throw new Error(`node ${nodeId} loop is an object with prompt, until, and max_iterations`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`node ${nodeId} loop is an object with prompt, until, and max_iterations`);
	}
	const loop = value as Record<string, unknown>;
	if (typeof loop.prompt !== "string" || loop.prompt.trim().length === 0) {
		throw new Error(`node ${nodeId} loop.prompt is required`);
	}
	if (typeof loop.until !== "string" || loop.until.trim().length === 0) {
		throw new Error(`node ${nodeId} loop.until is required`);
	}
	if (typeof loop.max_iterations !== "number" || !Number.isInteger(loop.max_iterations) || loop.max_iterations < 1) {
		throw new Error(`node ${nodeId} loop.max_iterations must be a positive integer`);
	}
	return { prompt: loop.prompt.trim(), until: loop.until.trim(), maxIterations: loop.max_iterations };
}

function readAllowedTools(value: unknown, nodeId: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`node ${nodeId} allowed_tools must be a list of tool names`);
	}
	return value;
}

function stringList(value: unknown, nodeId: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error(`node ${nodeId} depends_on must be a list of ids`);
	}
	return value.map((item) => (item as string).trim());
}

function stringListField(value: unknown, nodeId: string, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error(`node ${nodeId} ${field} must be a list of strings`);
	}
	return value.map((item) => (item as string).trim());
}

/** Topological order. Independent nodes keep their file order. */
export function orderNodes(workflow: ArchonWorkflow): ArchonNode[] {
	const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
	const index = new Map(workflow.nodes.map((node, position) => [node.id, position]));
	const remaining = new Map(workflow.nodes.map((node) => [node.id, new Set(node.dependsOn)]));
	const ordered: ArchonNode[] = [];
	while (ordered.length < workflow.nodes.length) {
		const ready = [...remaining.entries()]
			.filter(([, deps]) => deps.size === 0)
			.map(([id]) => id)
			.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
		if (ready.length === 0) {
			throw new Error("workflow has a cycle");
		}
		const id = ready[0];
		if (!id) {
			break;
		}
		remaining.delete(id);
		const node = byId.get(id);
		if (!node) {
			throw new Error(`missing node ${id}`);
		}
		ordered.push(node);
		for (const deps of remaining.values()) {
			deps.delete(id);
		}
	}
	return ordered;
}

/** Independent nodes (empty depends_on) share a wave. cpa-agents mapPar may run that wave. */
export function workflowWaves(workflow: ArchonWorkflow): ArchonNode[][] {
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
