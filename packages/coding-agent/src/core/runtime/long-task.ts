/**
 * Long-task pin: stay on the current climb floor and resume after a milestone yield.
 * Named climb, stuck escalate, Tooling delegate, and Archon subtasks still run.
 * Explicit new-topic still resets. Model `new_topic` does not park while pinned.
 */

import { parseDelegateAsk, parseDescalateAsk, parseEscalateAsk, stripEscalateSignal } from "./escalate.ts";
import { parseNewTopicSignal } from "./new-topic.ts";

const LONG_TASK =
	/\b(?:until you (?:complete|finish|done)|complete the whole|finish the whole|finish all|don'?t stop|do not stop|keep going(?: until)?|keep building(?: until)?|start building|start working|without stopping|run until done|autopilot|continue)\b/i;

const KEEP_ALIVE =
	/^(?:(?:ok(?:ay)?|please|pls)[,.]?\s+)*(?:continue(?:\s+with(?:\s+(?:the\s+)?(?:tasks?|work|it))?)?|keep going|keep (?:building|working)|proceed|resume|don'?t stop|do not stop)(?:\s+(?:pls|please|now))?[.!]?\s*$/i;

const PARTIAL =
	/\b(?:next:|will keep|remaining|milestone|progress is ongoing|started v\d|bumped versions|preparing the release|next milestone|pushed\.?$)\b/i;

const DONE =
	/\b(?:all (?:requested |remaining )?work is (?:done|complete)|the (?:task|release|original request) is (?:already |fully )?(?:done|complete|shipped|satisfied)|original request is (?:already |fully )?(?:done|complete|satisfied)|v\d+(?:\.\d+)* is (?:complete|released|shipped)|release published|nothing left to (?:do|run|create|attach|open)|there is nothing left|no (?:further|remaining) (?:work|steps)|no further work applies|fully satisfied|blocked(?:\s+on|\s*:)|need you to|waiting for (?:you|input|(?:the )?maintainer)|ready for (?:the )?maintainer|cannot continue|operation aborted)\b/i;

const CONTROL_ECHO = /\becho\s+['"`]?\{(?:\\.|[^}'"`]){0,240}"(?:escalate|descalate|action)"/i;

export type LongTaskResume =
	| { kind: "climb"; requested: "planning" | "frontier" | "next"; why: string }
	| { kind: "delegate"; why: string }
	| { kind: "drop"; requested: "workhorse"; why: string }
	| { kind: "stay" };

/** User asked Trek to finish the work without pausing at milestones. */
export function isLongTaskPrompt(text: string): boolean {
	return LONG_TASK.test(text.trim());
}

/** Bare keep-going ("continue", "continue with tasks pls") — keep the pinned goal. */
export function isLongTaskKeepAlive(text: string): boolean {
	return KEEP_ALIVE.test(text.trim());
}

/** Pin the real task, not a later "continue" follow-up. */
export function pinLongTaskGoal(input: { prompt: string; previousGoal?: string; previousTask?: string }): string {
	const prompt = input.prompt.trim();
	if (!isLongTaskKeepAlive(prompt)) {
		return prompt;
	}
	const prior = (input.previousGoal ?? input.previousTask ?? "").trim();
	return prior || prompt;
}

/** Last assistant turn looks like a slice, not the finished task. */
export function looksLikePartialMilestone(text: string): boolean {
	return PARTIAL.test(stripForMatch(text));
}

/** Last assistant turn looks finished or blocked on the user. */
export function looksLikeLongTaskDone(text: string): boolean {
	const body = stripForMatch(text);
	if (!DONE.test(body)) {
		return false;
	}
	if (/\bnext:\s*\S/i.test(body) && !/\bnothing left\b|\bno (?:further|remaining) (?:work|steps)\b/i.test(body)) {
		return false;
	}
	return true;
}

/**
 * Assistant only echoed layering control JSON (or bash `echo '{...}'`).
 * That is not progress; injecting another continue prompt loops the TUI.
 */
export function looksLikeLongTaskControlNoise(text: string): boolean {
	const stripped = stripEscalateSignal(stripForMatch(text)).trim();
	if (!stripped) {
		return true;
	}
	const compact = stripped.replace(/^(?:\$\s*)+/gm, "").trim();
	if (/^echo\s+['"`]?\{/i.test(compact)) {
		return true;
	}
	if (CONTROL_ECHO.test(compact) && compact.length < 400) {
		return true;
	}
	return /^(?:escalation noted|continue the same task until it is done)\b/i.test(compact);
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
	if (looksLikeLongTaskControlNoise(input.assistantText)) {
		const route = classifyLongTaskResume(input.assistantText);
		if (route.kind === "stay") {
			return false;
		}
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
	return `Continue the same task until it is done. Subtasks, handoffs, consults, and tool runners stay in play. Do not stop after one commit, one file, or one milestone. Do not wait for the user. When the original request is fully done, say that it is done and stop. Do not re-verify a finished request.

Original request:
"""
${clipped}
"""`;
}

function stripForMatch(text: string): string {
	return text.replace(/<honesty>[\s\S]*$/i, "").trim();
}
