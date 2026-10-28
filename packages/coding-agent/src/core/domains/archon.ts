/**
 * Archon workflow YAML (name, description, nodes).
 * A SKILL.md file is not a workflow.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";

export const ARCHON_NODE_KINDS = ["prompt", "command", "bash", "script", "loop"] as const;
export type ArchonNodeKind = (typeof ARCHON_NODE_KINDS)[number];

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
	if (kind === "loop") {
		const loop = readLoop(record.loop, id);
		return {
			id,
			kind,
			body: loop.prompt,
			dependsOn,
			allowedTools,
			loop: { until: loop.until, maxIterations: loop.maxIterations },
		};
	}
	if (kind === "script" && record.runtime !== "bun" && record.runtime !== "uv") {
		throw new Error(`node ${id} script requires runtime bun or uv`);
	}
	return {
		id,
		kind,
		body: (record[kind] as string).trim(),
		dependsOn,
		allowedTools,
	};
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
