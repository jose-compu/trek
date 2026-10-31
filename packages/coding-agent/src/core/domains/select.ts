/**
 * Pick one enabled domain for this turn.
 * A disabled domain scores zero. No hit records workflow none.
 */

import { type DomainCatalog, type DomainDefinition, enabledDomains } from "./catalog.ts";
import { type FilledParameter, fillWorkflowParameters } from "./parameters.ts";

export type SelectionReason = "match" | "none" | "operator_override";

export interface DomainSelection {
	domain: string;
	workflow: string;
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
		return selectionFrom(current.domain, "match", currentText, current.matched);
	}
	const previous = input.previous ? scoreDomains(catalog, input.previous) : undefined;
	if (previous && input.previous) {
		return selectionFrom(previous.domain, "match", input.previous, previous.matched);
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
	return selectionFrom(domain, "operator_override", "", []);
}

function selectionFrom(
	domain: DomainDefinition,
	selectionReason: SelectionReason,
	text: string,
	matched: string[],
): DomainSelection {
	return {
		domain: domain.id,
		workflow: domain.workflowName,
		selectionReason,
		nodeIds: domain.nodeIds,
		yaml: domain.yaml,
		parameters: fillWorkflowParameters(domain.id, text, matched),
	};
}

export function formatSelection(selection: DomainSelection): string {
	const nodes = selection.nodeIds.length > 0 ? ` nodes=${selection.nodeIds.join(",")}` : "";
	return `domain=${selection.domain} workflow=${selection.workflow} reason=${selection.selectionReason}${nodes}`;
}
