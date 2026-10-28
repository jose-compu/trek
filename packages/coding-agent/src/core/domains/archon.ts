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
	body: string;
	dependsOn: string[];
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
	const present = ARCHON_NODE_KINDS.filter(
		(kind) => typeof record[kind] === "string" && (record[kind] as string).trim().length > 0,
	);
	if (present.length !== 1) {
		throw new Error(`node ${record.id} needs one of prompt, command, bash, script, or loop`);
	}
	const kind = present[0];
	const dependsOn = record.depends_on === undefined ? [] : stringList(record.depends_on, record.id);
	return {
		id: record.id.trim(),
		kind,
		body: (record[kind] as string).trim(),
		dependsOn,
	};
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
