/**
 * Escalation ladder: Tooling → Workhorse → Planning → Frontier.
 * Explicit JSON, soft stuck phrases, or failures climb one (or more) steps.
 */

import type { ResolvedRuntime } from "./resolve.ts";

export const ESCALATION_LADDER = ["tooling", "workhorse", "planning", "frontier"] as const;
export type LadderRole = (typeof ESCALATION_LADDER)[number];

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

/** Pretty-printed or single-line escalate objects. */
const ESCALATE_JSON =
	/\{\s*"escalate"\s*:\s*"(next|tooling|workhorse|planning|frontier)"\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/is;

/**
 * Tiny Tooling models sometimes drop the opening brace:
 * escalate":"workhorse"  or  "escalate":"next"
 */
const ESCALATE_LOOSE =
	/"?escalate"?\s*:\s*"(next|tooling|workhorse|planning|frontier)"(?:\s*,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?/i;

const STUCK =
	/\b(i(?:'m| am) (?:stuck|unsure|confused)|need (?:a )?(?:plan|help|guidance|stronger model)|too (?:hard|complex|ambiguous)|cannot (?:decide|design|architect)|escalat(?:e|ion) (?:to |needed)|ask (?:planning|workhorse|frontier)|hand off to (?:planning|frontier|workhorse))\b/i;

export function isLadderRole(value: string): value is LadderRole {
	return (ESCALATION_LADDER as readonly string[]).includes(value);
}

export function ladderIndex(role: LadderRole): number {
	return ESCALATION_LADDER.indexOf(role);
}

export function isHigherLadderRole(current: LadderRole, candidate: LadderRole): boolean {
	return ladderIndex(candidate) > ladderIndex(current);
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

/**
 * Named tiers only move up; "next" climbs one step.
 * Same-or-lower named tiers also climb one step so a weak model cannot demote.
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

export function parseEscalateAsk(text: string): EscalateAsk | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
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

/** Strip escalate JSON so the user does not see the control line. */
export function stripEscalateSignal(text: string): string {
	return text
		.replace(ESCALATE_JSON, "")
		.replace(ESCALATE_LOOSE, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
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
export function formatEscalateCard(from: LadderRole, to: LadderRole, why?: string): string {
	const reason = why?.trim() ? ` · ${why.trim().slice(0, 48)}` : "";
	return `↑ ${from} → ${to}${reason}`;
}
