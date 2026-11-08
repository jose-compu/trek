/**
 * Long-task pin: stay on the current climb floor and resume after a milestone yield.
 * Named climb, stuck escalate, Tooling delegate, and Archon subtasks still run.
 * Explicit new-topic still resets. Model `new_topic` does not park while pinned.
 */

import { parseDelegateAsk, parseDescalateAsk, parseEscalateAsk } from "./escalate.ts";
import { parseNewTopicSignal } from "./new-topic.ts";

const LONG_TASK =
	/\b(?:until you (?:complete|finish|done)|complete the whole|finish the whole|finish all|don'?t stop|do not stop|keep going(?: until)?|keep building(?: until)?|start building|start working|without stopping|run until done|autopilot|continue)\b/i;

const PARTIAL =
	/\b(?:next:|will keep|remaining|milestone|progress is ongoing|started v\d|bumped versions|preparing the release|next milestone|pushed\.?$)\b/i;

const DONE =
	/\b(?:all (?:requested |remaining )?work is (?:done|complete)|the (?:task|release) is (?:done|complete|shipped)|v\d+(?:\.\d+)* is (?:complete|released|shipped)|release published|nothing left to do|blocked(?:\s+on|\s*:)|need you to|waiting for (?:you|input)|cannot continue)\b/i;

export type LongTaskResume =
	| { kind: "climb"; requested: "planning" | "frontier" | "next"; why: string }
	| { kind: "delegate"; why: string }
	| { kind: "drop"; requested: "workhorse"; why: string }
	| { kind: "stay" };

/** User asked Trek to finish the work without pausing at milestones. */
export function isLongTaskPrompt(text: string): boolean {
	return LONG_TASK.test(text.trim());
}

/** Last assistant turn looks like a slice, not the finished task. */
export function looksLikePartialMilestone(text: string): boolean {
	return PARTIAL.test(stripForMatch(text));
}

/** Last assistant turn looks finished or blocked on the user. */
export function looksLikeLongTaskDone(text: string): boolean {
	return DONE.test(stripForMatch(text));
}

export function shouldResumeLongTask(input: {
	pinned: boolean;
	assistantText: string;
	queued: boolean;
	stopReason?: string;
	hold?: boolean;
}): boolean {
	if (!input.pinned || input.queued || input.hold) {
		return false;
	}
	if (input.stopReason === "error" || input.stopReason === "aborted") {
		return false;
	}
	const text = stripForMatch(input.assistantText);
	if (!text) {
		return false;
	}
	if (looksLikeLongTaskDone(text)) {
		return false;
	}
	return true;
}

/** Route the next long-task slice. Ignore Decision park / new_topic while pinned. */
export function classifyLongTaskResume(text: string): LongTaskResume {
	const body = stripForMatch(text);
	if (!body) {
		return { kind: "stay" };
	}
	if (parseNewTopicSignal(body)) {
		return { kind: "stay" };
	}
	const delegate = parseDelegateAsk(body);
	if (delegate) {
		return { kind: "delegate", why: delegate.why };
	}
	const down = parseDescalateAsk(body);
	if (down?.requested === "decision") {
		return { kind: "stay" };
	}
	if (down && (down.requested === "workhorse" || down.requested === "next")) {
		return { kind: "drop", requested: "workhorse", why: down.why };
	}
	const up = parseEscalateAsk(body, "user");
	if (up?.explicit) {
		const requested = up.requested === "frontier" ? "frontier" : up.requested === "planning" ? "planning" : "next";
		return { kind: "climb", requested, why: up.why };
	}
	return { kind: "stay" };
}

export function longTaskContinuePrompt(goal: string): string {
	const clipped = goal.trim().slice(0, 800);
	return `Continue the same task until it is done. Subtasks, handoffs, consults, and tool runners stay in play. If you are stuck, emit {"escalate":"planning","why":"stuck"}. If you need live fetch or grep, emit {"action":"delegate","target":"tooling","reason":"live fetch"}. If the remaining work is mechanical, emit {"descalate":"workhorse","why":"simple again"}. Do not emit new_topic. Do not stop after one commit, one file, or one milestone. Do not wait for the user.

Original request:
"""
${clipped}
"""`;
}

function stripForMatch(text: string): string {
	return text.replace(/<honesty>[\s\S]*$/i, "").trim();
}
