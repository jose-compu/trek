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
		{ name: "violation", kind: "text", pattern: "(architecture violation)" },
		{ name: "debt", kind: "text", pattern: "(tech debt(?: is (?:the )?)?[^\\n.]*)" },
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
