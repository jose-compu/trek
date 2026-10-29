/**
 * In-session /domains and /workflows.
 * Same store as `trek domains enable|disable`. The command does not run a workflow.
 */

import { disableDomain, enableDomain, loadDomainCatalog } from "./catalog.ts";

const HELP = "Detection still chooses the workflow. This command only changes which domains are candidates.";

export function runDomainSessionCommand(cwd: string, name: "domains" | "workflows", arg: string): string {
	const parts = arg
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	const sub = parts[0] ?? "";
	try {
		if (name === "workflows" && sub === "show") {
			return showWorkflow(cwd, parts[1]);
		}
		if (name === "workflows" && (sub === "run" || sub === "enable" || sub === "disable")) {
			return "This command does not run a workflow. Detection chooses it on the next prompt.";
		}
		if (name === "domains" && sub === "enable") {
			requireId(parts[1], "/domains enable <id>");
			enableDomain(cwd, parts[1]);
			return formatDomainList(cwd);
		}
		if (name === "domains" && sub === "disable") {
			requireId(parts[1], "/domains disable <id>");
			disableDomain(cwd, parts[1]);
			return formatDomainList(cwd);
		}
		if (sub === "" || sub === "list") return formatDomainList(cwd);
		return usage(name);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function formatDomainList(cwd: string): string {
	const catalog = loadDomainCatalog(cwd);
	const rows = catalog.domains.map((domain) => {
		const on = domain.alwaysOn || !catalog.disabled.has(domain.id);
		const state = domain.alwaysOn ? "always" : on ? "on" : "off";
		return [domain.id, state, domain.workflowName];
	});
	return `${renderTextTable(["domain", "state", "workflow"], rows)}\n${HELP}`;
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
	const domain = loadDomainCatalog(cwd).domains.find((item) => item.id === id);
	if (!domain) throw new Error(`unknown domain ${id}`);
	const rows = domain.workflow.nodes.map((node) => {
		const after = node.dependsOn.length > 0 ? `after ${node.dependsOn.join(", ")}. ` : "";
		return [node.id, `${after}${oneLine(node.body)}`];
	});
	const description = oneLine(domain.description);
	return `${domain.id}  ${domain.workflowName}\n${description}\n\n${renderTextTable(["node", "step"], rows, [16, 48])}`;
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
			return ["list", "show"]
				.filter((item) => item.startsWith(sub ?? ""))
				.map((item) => ({ value: item, label: item, description: item === "show" ? "domain id" : "the table" }));
		}
		if (sub !== "show") return [];
		return catalog.domains
			.filter((domain) => domain.id.startsWith(partial))
			.map((domain) => ({ value: `show ${domain.id}`, label: domain.id, description: domain.workflowName }));
	}
	if (!sub || (rest.length === 0 && !text.endsWith(" "))) {
		return ["list", "enable", "disable"]
			.filter((item) => item.startsWith(sub ?? ""))
			.map((item) => ({ value: item, label: item }));
	}
	if (sub !== "enable" && sub !== "disable") return [];
	return catalog.domains
		.filter((domain) => domain.id.startsWith(partial))
		.filter((domain) => sub !== "disable" || !domain.alwaysOn)
		.map((domain) => ({ value: `${sub} ${domain.id}`, label: domain.id, description: domain.workflowName }));
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function requireId(id: string | undefined, usageText: string): asserts id is string {
	if (!id) throw new Error(`usage: ${usageText}`);
}

function usage(name: "domains" | "workflows"): string {
	if (name === "domains") return "usage: /domains | /domains enable <id> | /domains disable <id>";
	return "usage: /workflows | /workflows show <id>";
}
