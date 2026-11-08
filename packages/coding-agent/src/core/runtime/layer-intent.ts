/**
 * Soft layer intent. Named control pins win; this classifies the rest.
 * Heuristic never climbs to Planning. API Decision may.
 */

import { parseControlAsk } from "./layer-control.ts";
import { needsLiveNetwork } from "./layer-network.ts";

export const LAYER_INTENTS = ["planning", "tooling", "workhorse", "same-topic", "new-topic"] as const;
export type LayerIntent = (typeof LAYER_INTENTS)[number];

const SMALL_EDIT = /\b(typo|format|lint|rename|spell(?:ing)?)\b/i;

function tokens(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
		out.add(raw);
	}
	return out;
}

function overlap(a: string, b: string): number {
	const left = tokens(a);
	const right = tokens(b);
	if (left.size === 0 && right.size === 0) {
		return 1;
	}
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	let inter = 0;
	for (const t of left) {
		if (right.has(t)) {
			inter += 1;
		}
	}
	return inter / (left.size + right.size - inter);
}

export function parseLayerIntentReply(text: string): LayerIntent | undefined {
	const match = text.match(/"intent"\s*:\s*"(planning|tooling|workhorse|same-topic|new-topic)"/i);
	const value = match?.[1]?.toLowerCase();
	if (
		value === "planning" ||
		value === "tooling" ||
		value === "workhorse" ||
		value === "same-topic" ||
		value === "new-topic"
	) {
		return value;
	}
	return undefined;
}

export function layerIntentPrompt(previous: string, next: string): string {
	return `Previous user task:
"""
${previous.trim().slice(0, 500)}
"""

Current user task:
"""
${next.trim().slice(0, 800)}
"""

Reply with JSON only:
{"intent":"planning"|"tooling"|"workhorse"|"same-topic"|"new-topic"}

Rules:
- same-topic: follow-up on the previous task
- new-topic: unrelated new task
- tooling: search, logs, fetch, weather, live facts
- workhorse: act or edit on this turn; do not climb
- planning: architecture or multi-step design that needs the Planning SKU
- do not pick planning only because the word "plan" appears`;
}

/**
 * Cheap local classify. Never returns planning (Workhorse stays the actor
 * until a named climb, a failure, or a live Decision reply).
 */
export function classifyLayerIntentHeuristic(previous: string, next: string): LayerIntent {
	const curr = next.trim();
	if (!curr) {
		return "same-topic";
	}
	if (parseControlAsk(curr)) {
		return "same-topic";
	}
	if (needsLiveNetwork(curr)) {
		return "tooling";
	}
	if (SMALL_EDIT.test(curr) && !/\b(build|create|implement|scaffold)\b/i.test(curr)) {
		return "workhorse";
	}
	if (previous.trim()) {
		return "same-topic";
	}
	return "workhorse";
}

/** Ambiguous follow-up that used to trip Jaccard. Spend Decision only here. */
export function shouldAskDecisionIntent(previous: string, next: string): boolean {
	const prev = previous.trim();
	const curr = next.trim();
	if (!prev || !curr) {
		return false;
	}
	if (parseControlAsk(curr)) {
		return false;
	}
	if (curr.length < 24 || prev.length < 24) {
		return false;
	}
	return overlap(prev, curr) < 0.18;
}
