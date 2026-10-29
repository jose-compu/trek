/**
 * Values taken from the user turn that fill a detected workflow.
 * Named slots win. A bare term match keeps the sentence that contained it.
 */

export interface FilledParameter {
	name: string;
	kind: "text" | "number";
	value: string;
}

interface ParameterSpec {
	name: string;
	kind: "text" | "number";
	pattern: string;
}

const SPECS: Record<string, ParameterSpec[]> = {
	finance: [
		{ name: "account", kind: "number", pattern: "account\\s+(\\d+)" },
		{
			name: "period",
			kind: "text",
			pattern: "\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\b",
		},
		{ name: "amount", kind: "number", pattern: "\\bis\\s+(\\d+)\\b" },
		{ name: "control", kind: "text", pattern: "control is (?:the )?([^\\n.]+)" },
	],
	engineering: [
		{ name: "build", kind: "text", pattern: "(build failed(?: on [^,\\n.]+)?)" },
		{ name: "violation", kind: "text", pattern: "(architecture violation(?: is (?:the )?[^\\n.]+)?)" },
		{ name: "debt", kind: "text", pattern: "(tech debt(?: is (?:the )?[^\\n.]+)?)" },
	],
	security: [
		{ name: "secret", kind: "text", pattern: "(secret exposed(?: in [^,\\n.]+)?)" },
		{ name: "cve", kind: "text", pattern: "(CVE(?:-\\d{4}-\\d+)?)" },
	],
	coding: [
		{ name: "lint", kind: "text", pattern: "(lint error(?: in [^,\\n.]+)?)" },
		{ name: "type", kind: "text", pattern: "(type mismatch(?: in [^,\\n.]+)?)" },
	],
	legal: [{ name: "clause", kind: "text", pattern: "(unfavorable clause(?: in [^,\\n.]+)?)" }],
	science: [
		{ name: "leakage", kind: "text", pattern: "(data leakage)" },
		{ name: "split", kind: "text", pattern: "(train test split|train/test split)" },
	],
};

export function fillWorkflowParameters(domainId: string, text: string, matchedTerms: string[]): FilledParameter[] {
	const filled = (SPECS[domainId] ?? []).flatMap((spec) => {
		const value = capture(spec.pattern, text);
		if (!value) return [];
		return [{ name: spec.name, kind: spec.kind, value }];
	});
	if (filled.length > 0) return filled;
	return matchedTerms
		.map((term) => ({ name: term, kind: "text" as const, value: sentenceAround(text, term) }))
		.filter((row) => row.value.length > 0);
}

const BARE_FACT: Record<string, RegExp> = {
	build: /^build failed$/i,
	violation: /^architecture violation$/i,
	debt: /^tech debt$/i,
	secret: /^secret exposed$/i,
	cve: /^cve$/i,
	lint: /^lint error$/i,
	type: /^type mismatch$/i,
	clause: /^unfavorable clause$/i,
	leakage: /^data leakage$/i,
	split: /^(?:train test split|train\/test split)$/i,
};

/** Specs that are absent, or present only as the bare term. A bare term is not enough to start. */
export function missingWorkflowFacts(domainId: string, text: string): string[] {
	const specs = SPECS[domainId];
	if (!specs) return [];
	return specs.flatMap((spec) => {
		const value = capture(spec.pattern, text);
		return value && isSpecificFact(spec.name, value) ? [] : [spec.name];
	});
}

export function isSpecificFact(name: string, value: string): boolean {
	const bare = BARE_FACT[name];
	if (!bare) return value.trim().length > 0;
	return !bare.test(value.trim());
}

export function workflowFactQuestion(domainId: string, missing: readonly string[]): string {
	const list =
		missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
	return `Which ${list} are in scope for the ${domainId} workflow? Say stop to leave it unstarted.`;
}

export function workflowFactRefusal(text: string): boolean {
	return /^(?:no|nope|stop|skip|none|nothing|cancel|won'?t|will not|i (?:do not|don'?t) know|not now)\b/i.test(
		text.trim(),
	);
}

function capture(pattern: string, text: string): string {
	try {
		return new RegExp(pattern, "i").exec(text)?.[1]?.trim() ?? "";
	} catch {
		return "";
	}
}

function sentenceAround(text: string, term: string): string {
	const index = text.toLowerCase().indexOf(term.toLowerCase());
	if (index < 0) return "";
	const start = Math.max(text.lastIndexOf(".", index - 1) + 1, text.lastIndexOf("\n", index - 1) + 1, 0);
	const endDot = text.indexOf(".", index);
	const endNl = text.indexOf("\n", index);
	const end = endDot < 0 ? (endNl < 0 ? text.length : endNl) : endNl < 0 ? endDot : Math.min(endDot, endNl);
	return text.slice(start, end).trim().slice(0, 160);
}
