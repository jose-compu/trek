/**
 * Escalation ladder: Tooling → Workhorse → Planning → Frontier.
 * Climb on escalate/stuck/failures; drop on descalate or new topic (→ Decision).
 */

import type { ResolvedRuntime } from "./resolve.ts";

export const ESCALATION_LADDER = ["tooling", "workhorse", "planning", "frontier"] as const;
export type LadderRole = (typeof ESCALATION_LADDER)[number];

/** Ladder plus Decision floor (d1; not a chat/llama role). */
export type HierarchyRole = "decision" | LadderRole;

/** @deprecated Prefer LadderRole. */
export type EscalateTier = LadderRole;

export interface EscalateAsk {
	/** Named tier or relative next step. */
	requested: LadderRole | "next";
	why: string;
	explicit: boolean;
}

/** Resolved climb after availability checks. */
export interface EscalateSignal {
	tier: LadderRole;
	why: string;
	explicit: boolean;
}

/** Explicit drop toward a lower chat role, or Decision (lowest / new-topic floor). */
export interface DescalateAsk {
	requested: LadderRole | "next" | "decision";
	why: string;
	explicit: boolean;
}

/** Resolved drop after availability checks. `decision` parks the Decision floor. */
export interface DescalateSignal {
	tier: LadderRole | "decision";
	why: string;
	explicit: boolean;
}

/** Pretty-printed or single-line escalate objects. */
const ESCALATE_JSON =
	/\{\s*"escalate"\s*:\s*"(next|tooling|workhorse|planning|frontier)"\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/is;

/**
 * Tiny Tooling models sometimes drop the opening brace:
 * escalate":"workhorse"  or  "escalate":"next"
 * Negative lookbehind avoids matching inside "descalate".
 */
const ESCALATE_LOOSE =
	/(?<![a-z])"?escalate"?\s*:\s*"(next|tooling|workhorse|planning|frontier)"(?:\s*,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?/i;

const DESCALATE_JSON =
	/\{\s*"descalate"\s*:\s*"(next|tooling|workhorse|planning|decision)"\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/is;

const DESCALATE_LOOSE =
	/"?descalate"?\s*:\s*"(next|tooling|workhorse|planning|decision)"(?:\s*,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?/i;

// Soft stuck only — do NOT match "Escalate to tooling? No." (tiny models refuse and babble).
const STUCK =
	/\b(i(?:'m| am) (?:stuck|unsure|confused)|need (?:a )?(?:plan|help|guidance|stronger model)|too (?:hard|complex|ambiguous)|cannot (?:decide|design|architect)|escalation needed|please escalate|ask (?:planning|workhorse|frontier)|hand off to (?:planning|frontier|workhorse))\b/i;

/** Soft drop — Planning/Frontier handing simple remaining work down. */
const SIMPLE_AGAIN =
	/\b(this is (?:simple|easy|trivial)|simple (?:edit|fix|typo|rename)|hand off to (?:tooling|workhorse)|descalat(?:e|ion)(?:\s+needed)?|please descalate|too (?:much|heavy|strong) (?:a )?model|overkill|drop (?:to|down)|go back to (?:tooling|workhorse|decision)|new topic(?:\s+now)?|user switched (?:task|topic))\b/i;

/** User asks to drop a tier (or to a named lower role). */
const USER_DESCALATE =
	/^(?:\/descalate\b|descalate(?:\s+to\s+(?:tooling|workhorse|planning|decision))?|use (?:the )?(?:tooling|workhorse)(?:\s+model)?|go back to (?:tooling|workhorse|decision)|simpler model|↓\s*(?:tooling|workhorse|planning|decision)?)\b/i;

export type DescalateTarget = LadderRole | "next" | "decision";

export function isLadderRole(value: string): value is LadderRole {
	return (ESCALATION_LADDER as readonly string[]).includes(value);
}

export function ladderIndex(role: LadderRole): number {
	return ESCALATION_LADDER.indexOf(role);
}

export function isHigherLadderRole(current: LadderRole, candidate: LadderRole): boolean {
	return ladderIndex(candidate) > ladderIndex(current);
}

export function isLowerLadderRole(current: LadderRole, candidate: LadderRole): boolean {
	return ladderIndex(candidate) < ladderIndex(current);
}

export function roleAvailable(resolved: ResolvedRuntime, role: LadderRole): boolean {
	if (role === "frontier") {
		return Boolean(resolved.roles.frontier) && resolved.effectiveMode !== "local";
	}
	return Boolean(resolved.roles[role]);
}

/** Lowest assigned chat role. Local/hybrid start on Tooling when present. */
export function startLadderRole(resolved: ResolvedRuntime): LadderRole {
	if (resolved.effectiveMode === "api") {
		return "frontier";
	}
	for (const role of ESCALATION_LADDER) {
		if (role === "frontier") {
			continue;
		}
		if (roleAvailable(resolved, role)) {
			return role;
		}
	}
	return resolved.roles.frontier ? "frontier" : "workhorse";
}

/** Next stronger role that exists in this runtime, or undefined at the top. */
export function nextLadderRole(current: LadderRole, resolved: ResolvedRuntime): LadderRole | undefined {
	const start = ladderIndex(current) + 1;
	for (let i = start; i < ESCALATION_LADDER.length; i++) {
		const candidate = ESCALATION_LADDER[i]!;
		if (roleAvailable(resolved, candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/** Next weaker chat role that exists, or undefined at Tooling. */
export function prevLadderRole(current: LadderRole, resolved: ResolvedRuntime): LadderRole | undefined {
	for (let i = ladderIndex(current) - 1; i >= 0; i--) {
		const candidate = ESCALATION_LADDER[i]!;
		if (roleAvailable(resolved, candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * Named tiers only move up; "next" climbs one step.
 * Same-or-lower named escalate still climbs one step so a weak model cannot demote via escalate.
 * Use descalate to move down.
 */
export function resolveEscalateTarget(
	current: LadderRole,
	requested: LadderRole | "next",
	resolved: ResolvedRuntime,
): LadderRole | undefined {
	if (requested === "next") {
		return nextLadderRole(current, resolved);
	}
	if (isHigherLadderRole(current, requested) && roleAvailable(resolved, requested)) {
		return requested;
	}
	return nextLadderRole(current, resolved);
}

/**
 * Named descalate only moves down; "next" drops one step; "decision" is the floor.
 * Same-or-higher named chat targets drop one step when a lower role exists.
 */
export function resolveDescalateTarget(
	current: LadderRole,
	requested: LadderRole | "next" | "decision",
	resolved: ResolvedRuntime,
): LadderRole | "decision" | undefined {
	if (requested === "decision") {
		return "decision";
	}
	if (requested === "next") {
		return prevLadderRole(current, resolved);
	}
	if (isLowerLadderRole(current, requested) && roleAvailable(resolved, requested)) {
		return requested;
	}
	return prevLadderRole(current, resolved);
}

export function parseEscalateAsk(text: string): EscalateAsk | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	// Prefer descalate JSON when both appear — do not also climb.
	if (trimmed.match(DESCALATE_JSON) || trimmed.match(DESCALATE_LOOSE)) {
		return undefined;
	}
	const match = trimmed.match(ESCALATE_JSON) ?? trimmed.match(ESCALATE_LOOSE);
	if (match) {
		const requested = match[1]!.toLowerCase() as LadderRole | "next";
		const why = (match[2] ?? "").replace(/\\"/g, '"').trim() || "model requested elevation";
		return { requested, why, explicit: true };
	}
	if (STUCK.test(trimmed)) {
		return { requested: "next", why: "model reported being stuck", explicit: false };
	}
	return undefined;
}

export function parseDescalateAsk(text: string): DescalateAsk | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	const match = trimmed.match(DESCALATE_JSON) ?? trimmed.match(DESCALATE_LOOSE);
	if (match) {
		const raw = match[1]!.toLowerCase();
		const why = (match[2] ?? "").replace(/\\"/g, '"').trim() || "model requested descalation";
		if (raw === "decision") {
			return { requested: "decision", why, explicit: true };
		}
		return { requested: raw as LadderRole | "next", why, explicit: true };
	}
	if (USER_DESCALATE.test(trimmed)) {
		if (/\bdecision\b/i.test(trimmed)) {
			return { requested: "decision", why: "user requested descalation", explicit: true };
		}
		const named = trimmed.match(/\b(tooling|workhorse|planning)\b/i)?.[1]?.toLowerCase();
		return {
			requested: named && isLadderRole(named) && named !== "frontier" ? named : "next",
			why: "user requested descalation",
			explicit: true,
		};
	}
	if (SIMPLE_AGAIN.test(trimmed)) {
		if (/\bdecision\b|new topic|switched (?:task|topic)/i.test(trimmed)) {
			return { requested: "decision", why: "model reported topic reset", explicit: false };
		}
		const named = trimmed.match(/\b(tooling|workhorse)\b/i)?.[1]?.toLowerCase();
		return {
			requested: named && isLadderRole(named) ? named : "next",
			why: "model reported simpler remaining work",
			explicit: false,
		};
	}
	return undefined;
}

/** Parse and resolve against the current ladder position. */
export function parseEscalateSignal(
	text: string,
	current: LadderRole,
	resolved: ResolvedRuntime,
): EscalateSignal | undefined {
	const ask = parseEscalateAsk(text);
	if (!ask) {
		return undefined;
	}
	const tier = resolveEscalateTarget(current, ask.requested, resolved);
	if (!tier) {
		return undefined;
	}
	return { tier, why: ask.why, explicit: ask.explicit };
}

/** Parse and resolve a drop against the current ladder position. */
export function parseDescalateSignal(
	text: string,
	current: LadderRole,
	resolved: ResolvedRuntime,
): DescalateSignal | undefined {
	const ask = parseDescalateAsk(text);
	if (!ask) {
		return undefined;
	}
	const tier = resolveDescalateTarget(current, ask.requested, resolved);
	if (!tier) {
		return undefined;
	}
	return { tier, why: ask.why, explicit: ask.explicit };
}

/** Strip escalate / descalate JSON so the user does not see the control line. */
export function stripEscalateSignal(text: string): string {
	return text
		.replace(DESCALATE_JSON, "")
		.replace(DESCALATE_LOOSE, "")
		.replace(ESCALATE_JSON, "")
		.replace(ESCALATE_LOOSE, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Schema / argument validation failures (e.g. write without `path`) mean the
 * current tier cannot form tool calls — climb immediately, do not wait for a streak.
 */
export function isToolArgumentValidationError(text: string): boolean {
	const t = text.trim();
	if (!t) {
		return false;
	}
	if (/Validation failed for tool\s+"/i.test(t)) {
		return true;
	}
	if (/must have required propert/i.test(t) && /\b(?:path|command|content|edits|oldText|newText)\b/i.test(t)) {
		return true;
	}
	if (/\bReceived arguments:\s*\{/i.test(t) && /\bmust have required propert/i.test(t)) {
		return true;
	}
	return false;
}

export function escalateComplexity(tier: LadderRole): number {
	switch (tier) {
		case "frontier":
			return 0.85;
		case "planning":
			return 0.55;
		case "workhorse":
			return 0.35;
		default:
			return 0.15;
	}
}

/** One-line status for the discreet console card. */
export function formatEscalateCard(from: HierarchyRole, to: HierarchyRole, why?: string): string {
	const reason = why?.trim() ? ` · ${why.trim().slice(0, 48)}` : "";
	return `↑ ${from} → ${to}${reason}`;
}

/** One-line status when a new topic drops back toward Decision. */
export function formatDescalateCard(from: HierarchyRole, to: HierarchyRole, why?: string): string {
	const reason = why?.trim() ? ` · ${why.trim().slice(0, 48)}` : "";
	return `↓ ${from} → ${to}${reason}`;
}
