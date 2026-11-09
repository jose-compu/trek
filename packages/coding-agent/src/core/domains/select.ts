/**
 * Pick one enabled domain for this turn.
 * A disabled domain scores zero. No hit records workflow none.
 */

import { type DomainCatalog, type DomainDefinition, enabledDomains, type WorkflowEntry } from "./catalog.ts";
import { type FilledParameter, fillWorkflowParameters } from "./parameters.ts";

export type SelectionReason = "match" | "none" | "operator_override";

export interface DomainSelection {
	domain: string;
	workflow: string;
	/** Bundled layer-* id for this turn, or `none`. */
	layer_workflow: string;
	selectionReason: SelectionReason;
	nodeIds: string[];
	yaml: string;
	parameters: FilledParameter[];
}

export interface SelectDomainInput {
	task: string;
	files?: string[];
	previous?: string;
}

const NONE: DomainSelection = {
	domain: "none",
	workflow: "none",
	layer_workflow: "none",
	selectionReason: "none",
	nodeIds: [],
	yaml: "",
	parameters: [],
};

/** A fix, a push, or a blocked session needs tools. A review workflow must not take that turn. */
export function turnNeedsTools(task: string): boolean {
	return /\b(fix|push|blocked|unblock|what is happening|what happened)\b/i.test(task);
}

export function selectDomain(catalog: DomainCatalog, input: SelectDomainInput): DomainSelection {
	if (turnNeedsTools(input.task)) return NONE;
	const files = [...(input.files ?? []), ...namedFiles(input.task)];
	const currentText = [input.task, ...files].join("\n");
	const current = scoreDomains(catalog, currentText);
	if (current) {
		return selectionFrom(current.domain, "match", currentText, current.matched, currentText);
	}
	const previous = input.previous ? scoreDomains(catalog, input.previous) : undefined;
	if (previous && input.previous) {
		return selectionFrom(previous.domain, "match", input.previous, previous.matched, currentText);
	}
	return NONE;
}

function namedFiles(task: string): string[] {
	return task.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}/g) ?? [];
}

function scoreDomains(
	catalog: DomainCatalog,
	text: string,
): { domain: DomainDefinition; matched: string[] } | undefined {
	const haystack = text.toLowerCase();
	let best: { domain: DomainDefinition; score: number; weight: number; matched: string[] } | undefined;
	for (const domain of enabledDomains(catalog)) {
		let score = 0;
		let weight = 0;
		const matched: string[] = [];
		for (const term of domain.terms) {
			if (term.length > 0 && haystack.includes(term)) {
				score += 1;
				weight += term.length;
				matched.push(term);
			}
		}
		if (score === 0) {
			continue;
		}
		if (
			!best ||
			score > best.score ||
			(score === best.score && weight > best.weight) ||
			(score === best.score && weight === best.weight && domain.id < best.domain.id)
		) {
			best = { domain, score, weight, matched };
		}
	}
	return best ? { domain: best.domain, matched: best.matched } : undefined;
}

export function overrideSelection(catalog: DomainCatalog, id: string): DomainSelection {
	const domain = catalog.domains.find((item) => item.id === id);
	if (!domain) {
		throw new Error(`unknown domain ${id}`);
	}
	if (!domain.alwaysOn && catalog.disabled.has(domain.id)) {
		throw new Error(`${domain.title} is disabled`);
	}
	return selectionFrom(domain, "operator_override", "", [], "");
}

function selectionFrom(
	domain: DomainDefinition,
	selectionReason: SelectionReason,
	text: string,
	matched: string[],
	currentText: string,
): DomainSelection {
	if (domain.workflows && domain.workflows.length > 0) {
		const selected = selectWorkflowFromDomain(domain, currentText);
		return {
			domain: domain.id,
			workflow: selected.name,
			layer_workflow: "none",
			selectionReason,
			nodeIds: selected.nodeIds,
			yaml: selected.yaml,
			parameters: fillWorkflowParameters(domain.id, text, matched),
		};
	}
	return {
		domain: domain.id,
		workflow: domain.workflowName,
		layer_workflow: "none",
		selectionReason,
		nodeIds: domain.nodeIds,
		yaml: domain.yaml,
		parameters: fillWorkflowParameters(domain.id, text, matched),
	};
}

function selectWorkflowFromDomain(
	domain: DomainDefinition,
	text: string,
): { name: string; yaml: string; nodeIds: string[] } {
	if (!domain.workflows || domain.workflows.length === 0) {
		return { name: domain.workflowName, yaml: domain.yaml, nodeIds: domain.nodeIds };
	}
	const haystack = text.toLowerCase();
	let best: { workflow: WorkflowEntry; score: number; weight: number } | undefined;
	for (const workflow of domain.workflows) {
		let score = 0;
		let weight = 0;
		for (const term of workflow.terms) {
			if (term.length > 0 && haystack.includes(term)) {
				score += 1;
				weight += term.length;
			}
		}
		if (score === 0 && domain.workflows.length === 1) {
			return { name: workflow.name, yaml: workflow.yaml, nodeIds: workflow.nodeIds };
		}
		if (score === 0) {
			continue;
		}
		if (
			!best ||
			score > best.score ||
			(score === best.score && weight > best.weight) ||
			(score === best.score && weight === best.weight && workflow.name < best.workflow.name)
		) {
			best = { workflow, score, weight };
		}
	}
	if (best) {
		return { name: best.workflow.name, yaml: best.workflow.yaml, nodeIds: best.workflow.nodeIds };
	}
	return { name: domain.workflows[0].name, yaml: domain.workflows[0].yaml, nodeIds: domain.workflows[0].nodeIds };
}

export function formatSelection(selection: DomainSelection): string {
	const nodes = selection.nodeIds.length > 0 ? ` nodes=${selection.nodeIds.join(",")}` : "";
	const layer = selection.layer_workflow ?? "none";
	return `domain=${selection.domain} workflow=${selection.workflow} layer_workflow=${layer} reason=${selection.selectionReason}${nodes}`;
}
