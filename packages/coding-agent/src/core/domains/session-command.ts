/**
 * In-session /domains and /workflows.
 * Same store as `trek domains enable|disable`. The command does not run a workflow.
 */

import {
	type DomainDefinition,
	disableDomain,
	enableDomain,
	findLayerWorkflow,
	loadDomainCatalog,
	loadLayerWorkflows,
	type WorkflowEntry,
} from "./catalog.ts";
import { formatLessonPattern, lessonPatternFor } from "./lesson-pattern.ts";

const HELP = "Detection still chooses the workflow. This command only changes which domains are candidates.";

/** Session hint so interactive mode can open a create/add ask. */
export type DomainSessionAction =
	| { kind: "text"; text: string }
	| { kind: "create-domain"; id: string }
	| { kind: "add-workflow"; domain: string; workflowName: string };

export function runDomainSessionCommand(cwd: string, name: "domains" | "workflows", arg: string): string {
	const action = dispatchDomainSessionCommand(cwd, name, arg);
	return action.kind === "text" ? action.text : formatDomainSessionHint(action);
}

export function dispatchDomainSessionCommand(
	cwd: string,
	name: "domains" | "workflows",
	arg: string,
): DomainSessionAction {
	const parts = arg
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	const sub = parts[0] ?? "";
	try {
		if (name === "workflows" && sub === "show") {
			return { kind: "text", text: showWorkflow(cwd, parts[1]) };
		}
		if (name === "workflows" && sub === "add") {
			requireId(parts[1], "/workflows add <domain> <workflow>");
			requireId(parts[2], "/workflows add <domain> <workflow>");
			return { kind: "add-workflow", domain: parts[1], workflowName: parts[2] };
		}
		if (name === "workflows" && (sub === "run" || sub === "enable" || sub === "disable")) {
			return {
				kind: "text",
				text: "This command does not run a workflow. Detection chooses it on the next prompt.",
			};
		}
		if (name === "domains" && sub === "add") {
			requireId(parts[1], "/domains add <id>");
			return { kind: "create-domain", id: parts[1] };
		}
		if (name === "domains" && sub === "enable") {
			requireId(parts[1], "/domains enable <id>");
			enableDomain(cwd, parts[1]);
			return { kind: "text", text: formatDomainList(cwd) };
		}
		if (name === "domains" && sub === "disable") {
			requireId(parts[1], "/domains disable <id>");
			disableDomain(cwd, parts[1]);
			return { kind: "text", text: formatDomainList(cwd) };
		}
		if (name === "domains" && (sub === "show" || looksLikeDomainId(sub))) {
			const id = sub === "show" ? parts[1] : sub;
			requireId(id, "/domains <id>");
			return { kind: "text", text: formatDomainHelp(cwd, id) };
		}
		if (sub === "" || sub === "list") {
			return {
				kind: "text",
				text: name === "workflows" ? formatWorkflowList(cwd) : formatDomainList(cwd),
			};
		}
		return { kind: "text", text: usage(name) };
	} catch (error) {
		return { kind: "text", text: error instanceof Error ? error.message : String(error) };
	}
}

function formatDomainSessionHint(action: DomainSessionAction): string {
	if (action.kind === "text") return action.text;
	if (action.kind === "create-domain") {
		return `Say what the ${action.id} domain workflow should do, or paste Archon YAML. Say stop to cancel.`;
	}
	return `Say what the ${action.workflowName} workflow on ${action.domain} should do, or paste Archon YAML. Say stop to cancel.`;
}

export function formatDomainList(cwd: string): string {
	const catalog = loadDomainCatalog(cwd);
	const layerCount = loadLayerWorkflows().length;
	const rows = catalog.domains.map((domain) => {
		const on = domain.alwaysOn || !catalog.disabled.has(domain.id);
		const state = domain.alwaysOn ? "always" : on ? "on" : "off";
		return [domain.id, state, formatWorkflowNames(domain), formatDomainFeatures(cwd, domain, layerCount)];
	});
	return `${renderTextTable(["domain", "state", "workflows", "features"], rows, [14, 8, 36, 48])}\n${HELP}`;
}

function formatWorkflowNames(domain: DomainDefinition): string {
	if (!domain.workflows || domain.workflows.length === 0) return domain.workflowName;
	return domain.workflows
		.map((workflow) => (workflow.terms.length > 0 ? workflow.name : `${workflow.name}*`))
		.join(", ");
}

/** Compact special capabilities: lesson types, promotion, host adapters, layer DAGs. */
function formatDomainFeatures(cwd: string, domain: DomainDefinition, layerCount: number): string {
	const bits: string[] = [];
	const pattern = lessonPatternFor(cwd, domain.id);
	if (pattern && pattern.categories.length > 0) {
		bits.push(`lessons: ${pattern.categories.join(", ")}`);
	}
	if (pattern && pattern.promotionTargets.length > 0) {
		bits.push(`promote: ${pattern.promotionTargets.map((target) => target.title).join(", ")}`);
	}
	if (pattern && pattern.fields.length > 0) {
		bits.push(`fields: ${pattern.fields.map((field) => field.name).join(", ")}`);
	}
	if (
		domain.workflows?.some((workflow) => workflow.name === "_detect-host" || workflow.file === "_detect-host.yaml")
	) {
		bits.push("host-adapters");
	}
	if (domain.id === "meta" && layerCount > 0) {
		bits.push(`${layerCount}-layer-DAGs`);
	}
	if (domain.added) bits.push("project-added");
	return bits.length > 0 ? bits.join("; ") : "(none)";
}

export function formatWorkflowList(cwd: string): string {
	const domains = formatDomainList(cwd);
	const multi = formatMultiWorkflowCatalog(cwd);
	const layers = loadLayerWorkflows().map((workflow) => [workflow.name, String(workflow.nodes.length)]);
	const table = renderTextTable(["layer", "nodes"], layers);
	const parts = [domains];
	if (multi) parts.push(multi);
	parts.push(`layer workflows\n${table}`);
	return parts.join("\n");
}

/** Domains that ship more than one Archon DAG, with trigger phrases. */
function formatMultiWorkflowCatalog(cwd: string): string {
	const catalog = loadDomainCatalog(cwd);
	const sections: string[] = [];
	for (const domain of catalog.domains) {
		if (!domain.workflows || domain.workflows.length <= 1) continue;
		sections.push(formatDomainWorkflowTable(domain));
	}
	return sections.join("\n");
}

/** One domain: state, terms, lesson categories, and workflows. */
export function formatDomainHelp(cwd: string, id: string): string {
	const catalog = loadDomainCatalog(cwd);
	const domain = catalog.domains.find((item) => item.id === id);
	if (!domain) throw new Error(`unknown domain ${id}`);
	const on = domain.alwaysOn || !catalog.disabled.has(domain.id);
	const state = domain.alwaysOn ? "always on" : on ? "on" : "off";
	const parts = [
		`${domain.id}  ${domain.title}`,
		`state: ${state}`,
		`terms: ${domain.terms.length > 0 ? domain.terms.join(", ") : "(none)"}`,
	];
	const pattern = lessonPatternFor(cwd, domain.id);
	parts.push("");
	parts.push(pattern ? formatLessonPattern(pattern) : "lessons: (none)");
	parts.push("");
	if (domain.workflows && domain.workflows.length > 1) {
		parts.push(formatDomainWorkflowTable(domain));
		parts.push("");
		parts.push(`/workflows show <workflow> prints one DAG. Primary: ${domain.workflowName}.`);
	} else {
		parts.push(`${domain.id}  ${domain.workflowName}`);
		parts.push(oneLine(domain.description));
		parts.push("");
		parts.push(formatNodeRows(domain.workflow.nodes));
	}
	parts.push("");
	parts.push(HELP);
	return parts.join("\n");
}

function formatDomainWorkflowTable(domain: DomainDefinition): string {
	const rows = (domain.workflows ?? []).map((workflow) => [
		workflow.name,
		workflow.terms.length > 0 ? workflow.terms.join(", ") : "(include only)",
	]);
	return `${domain.id} workflows\n${renderTextTable(["workflow", "say"], rows, [24, 56])}`;
}

function looksLikeDomainId(token: string): boolean {
	return /^[a-z][a-z0-9-]{0,40}$/.test(token);
}

function renderTextTable(headers: string[], rows: string[][], maxWidths?: number[]): string {
	const widths = headers.map((header, index) => {
		const natural = Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
		const cap = maxWidths?.[index];
		return cap ? Math.max(header.length, Math.min(natural, cap)) : natural;
	});
	const rule = (left: string, mid: string, right: string) =>
		`${left}${widths.map((width) => "─".repeat(width + 2)).join(mid)}${right}`;
	const line = (cells: string[]) =>
		`│${cells.map((cell, index) => ` ${cell.padEnd(widths[index] ?? 0)} `).join("│")}│`;
	const body = rows.flatMap((row) => {
		const wrapped = row.map((cell, index) => wrapCell(cell ?? "", widths[index] ?? 1));
		const height = Math.max(1, ...wrapped.map((cell) => cell.length));
		const lines: string[] = [];
		for (let index = 0; index < height; index++) {
			lines.push(line(wrapped.map((cell) => cell[index] ?? "")));
		}
		return lines;
	});
	return [rule("┌", "┬", "┐"), line(headers), rule("├", "┼", "┤"), ...body, rule("└", "┴", "┘")].join("\n");
}

function wrapCell(text: string, width: number): string[] {
	const words = text.split(" ").filter((word) => word.length > 0);
	if (words.length === 0) return [""];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const piece = word.length > width ? word.slice(0, width) : word;
		if (!current) current = piece;
		else if (current.length + 1 + piece.length <= width) current = `${current} ${piece}`;
		else {
			lines.push(current);
			current = piece;
		}
	}
	if (current) lines.push(current);
	return lines;
}

function showWorkflow(cwd: string, id: string | undefined): string {
	requireId(id, "/workflows show <id>");
	const layer = findLayerWorkflow(id);
	if (layer) {
		return formatNodeTable(layer.name, layer.description, layer.nodes);
	}
	const catalog = loadDomainCatalog(cwd);
	const named = findNamedWorkflow(catalog.domains, id);
	if (named) {
		const terms =
			named.entry.terms.length > 0
				? `say: ${named.entry.terms.join(", ")}`
				: "include-only helper; detection does not select it alone";
		return `${named.domain.id}  ${named.entry.name}\n${terms}\n${oneLine(named.entry.description)}\n\n${formatNodeRows(named.entry.workflow.nodes)}`;
	}
	const domain = catalog.domains.find((item) => item.id === id);
	if (!domain) throw new Error(`unknown domain ${id}`);
	if (domain.workflows && domain.workflows.length > 1) {
		const rows = domain.workflows.map((workflow) => [
			workflow.name,
			workflow.terms.length > 0 ? workflow.terms.join(", ") : "(include only)",
		]);
		const catalogTable = renderTextTable(["workflow", "say"], rows, [24, 56]);
		return `${domain.id} workflows\n${catalogTable}\n\n/workflows show <workflow> prints one DAG. Primary: ${domain.workflowName}.`;
	}
	return `${domain.id}  ${domain.workflowName}\n${oneLine(domain.description)}\n\n${formatNodeRows(domain.workflow.nodes)}`;
}

function findNamedWorkflow(
	domains: DomainDefinition[],
	id: string,
): { domain: DomainDefinition; entry: WorkflowEntry } | undefined {
	for (const domain of domains) {
		const entry = domain.workflows?.find((workflow) => workflow.name === id);
		if (entry) return { domain, entry };
	}
	return undefined;
}

function formatNodeTable(
	name: string,
	description: string,
	nodes: Array<{ id: string; dependsOn: string[]; body: string }>,
): string {
	return `${name}\n${oneLine(description)}\n\n${formatNodeRows(nodes)}`;
}

function formatNodeRows(nodes: Array<{ id: string; dependsOn: string[]; body: string }>): string {
	const rows = nodes.map((node) => {
		const after = node.dependsOn.length > 0 ? `after ${node.dependsOn.join(", ")}. ` : "";
		return [node.id, `${after}${oneLine(node.body)}`];
	});
	return renderTextTable(["node", "step"], rows, [16, 48]);
}

/** Completions for `/domains` and `/workflows`. These are domain ids, not files. */
export function completeDomainCommand(
	cwd: string,
	name: "domains" | "workflows",
	argumentPrefix: string,
): Array<{ value: string; label: string; description?: string }> {
	const catalog = loadDomainCatalog(cwd);
	const text = argumentPrefix.trimStart();
	const [sub, ...rest] = text.split(/\s+/).filter((part) => part.length > 0);
	const partial = rest.join(" ");
	if (name === "workflows") {
		if (!sub || (rest.length === 0 && !text.endsWith(" "))) {
			return ["list", "show", "add"]
				.filter((item) => item.startsWith(sub ?? ""))
				.map((item) => ({
					value: item,
					label: item,
					description: item === "show" ? "domain id" : item === "add" ? "domain workflow" : "the table",
				}));
		}
		if (sub === "add") {
			if (rest.length === 0 || (rest.length === 1 && !text.endsWith(" "))) {
				return catalog.domains
					.filter((domain) => domain.id.startsWith(partial))
					.map((domain) => ({
						value: `add ${domain.id}`,
						label: domain.id,
						description: "then workflow name",
					}));
			}
			return [];
		}
		if (sub !== "show") return [];
		const domains = catalog.domains
			.filter((domain) => domain.id.startsWith(partial))
			.map((domain) => ({
				value: `show ${domain.id}`,
				label: domain.id,
				description:
					domain.workflows && domain.workflows.length > 1
						? `${domain.workflows.length} workflows`
						: domain.workflowName,
			}));
		const named = catalog.domains.flatMap((domain) =>
			(domain.workflows ?? [])
				.filter((workflow) => workflow.name.startsWith(partial))
				.map((workflow) => ({
					value: `show ${workflow.name}`,
					label: workflow.name,
					description: domain.id,
				})),
		);
		const layers = loadLayerWorkflows()
			.filter((workflow) => workflow.name.startsWith(partial))
			.map((workflow) => ({
				value: `show ${workflow.name}`,
				label: workflow.name,
				description: "layer",
			}));
		return [...domains, ...named, ...layers];
	}
	if (!sub || (rest.length === 0 && !text.endsWith(" "))) {
		const verbs = ["list", "show", "add", "enable", "disable"]
			.filter((item) => item.startsWith(sub ?? ""))
			.map((item) => ({ value: item, label: item }));
		const ids = catalog.domains
			.filter((domain) => domain.id.startsWith(sub ?? ""))
			.map((domain) => ({
				value: domain.id,
				label: domain.id,
				description:
					domain.workflows && domain.workflows.length > 1
						? `${domain.workflows.length} workflows`
						: domain.workflowName,
			}));
		return [...verbs, ...ids];
	}
	if (sub !== "enable" && sub !== "disable" && sub !== "show" && sub !== "add") return [];
	return catalog.domains
		.filter((domain) => domain.id.startsWith(partial))
		.filter((domain) => sub !== "disable" || !domain.alwaysOn)
		.map((domain) => ({
			value: `${sub} ${domain.id}`,
			label: domain.id,
			description:
				domain.workflows && domain.workflows.length > 1
					? `${domain.workflows.length} workflows`
					: domain.workflowName,
		}));
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function requireId(id: string | undefined, usageText: string): asserts id is string {
	if (!id) throw new Error(`usage: ${usageText}`);
}

function usage(name: "domains" | "workflows"): string {
	if (name === "domains") {
		return "usage: /domains | /domains <id> | /domains add <id> | /domains enable <id> | /domains disable <id>\n  /domains coding shows workflows and lesson categories for that domain.\n  /domains add <id> asks what the new domain workflow should do.";
	}
	return "usage: /workflows | /workflows show <domain|workflow> | /workflows add <domain> <workflow>\n  The list includes each coding workflow and its trigger phrases.\n  /workflows add asks what the new workflow should do.";
}
