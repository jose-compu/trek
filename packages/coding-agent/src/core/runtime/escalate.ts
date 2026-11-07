/**
 * Escalation ladder: Workhorse ⇄ Planning ⇄ Frontier.
 * Tooling is a supporting runner (delegate), not a rung.
 * Climb on escalate/stuck/failures; drop on descalate or new topic (→ Decision).
 */

import { parseLayerDecision } from "./layer-decision.ts";
import type { ResolvedRuntime } from "./resolve.ts";

export const ESCALATION_LADDER = ["workhorse", "planning", "frontier"] as const;
export type LadderRole = (typeof ESCALATION_LADDER)[number];

/** Display floor: Decision, the climb, or Tooling when a runner is bound. */
export type HierarchyRole = "decision" | "tooling" | LadderRole;

/** @deprecated Prefer LadderRole. */
export type EscalateTier = LadderRole;

export interface EscalateAsk {
	/** Named tier or relative next step. Tooling is not a climb target. */
	requested: LadderRole | "next";
	why: string;
	explicit: boolean;
}

/** Resolved climb after availability checks. */
export interface EscalateSignal {
	tier: LadderRole;
	why: string;
	explicit: boolean;
	/** True when Frontier was requested but Planning+deep is the consult. */
	aliased?: boolean;
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

/** Workhorse/Planning delegate a runner job; the climb floor does not move. */
export interface DelegateAsk {
	target: "tooling";
	why: string;
	explicit: boolean;
}

/** Pretty-printed or single-line escalate objects. Tooling is not a valid climb. */
const ESCALATE_JSON =
	/\{\s*"escalate"\s*:\s*"(next|workhorse|planning|frontier)"\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/is;

/**
 * Weak models sometimes drop the opening brace:
 * escalate":"planning"  or  "escalate":"next"
 * Negative lookbehind avoids matching inside "descalate".
 */
const ESCALATE_LOOSE =
	/(?<![a-z])"?escalate"?\s*:\s*"(next|workhorse|planning|frontier)"(?:\s*,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?/i;

const DESCALATE_JSON =
	/\{\s*"descalate"\s*:\s*"(next|workhorse|planning|decision)"\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/is;

const DESCALATE_LOOSE =
	/"?descalate"?\s*:\s*"(next|workhorse|planning|decision)"(?:\s*,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?/i;

const DELEGATE_JSON = /\{\s*"(?:delegate|action)"\s*:\s*"(?:delegate|tooling)"[\s\S]{0,200}?"target"\s*:\s*"tooling"/is;

const DELEGATE_LOOSE = /\b(?:delegate|hand off) to tooling\b|"target"\s*:\s*"tooling"/i;

// Soft stuck only — do NOT match "Escalate to tooling? No." (tiny models refuse and babble).
const STUCK =
	/\b(i(?:'m| am) (?:stuck|unsure|confused)|need (?:a )?(?:plan|help|guidance|stronger model)|too (?:hard|complex|ambiguous)|cannot (?:decide|design|architect)|escalation needed|please escalate|ask (?:planning|workhorse|frontier)|hand off to (?:planning|frontier|workhorse))\b/i;

/** Soft drop — Planning/Frontier handing simple remaining work down. Not a Tooling bind. */
const SIMPLE_AGAIN =
	/\b(this is (?:simple|easy|trivial)|simple (?:edit|fix|typo|rename)|hand off to workhorse|descalat(?:e|ion)(?:\s+needed)?|please descalate|too (?:much|heavy|strong) (?:a )?model|overkill|drop (?:to|down)|go back to (?:workhorse|decision)|new topic(?:\s+now)?|user switched (?:task|topic))\b/i;

/** User asks to drop a tier (or to a named lower role). "use tooling" is a runner, not a drop. */
const USER_DESCALATE =
	/^(?:\/descalate\b|descalate(?:\s+to\s+(?:workhorse|planning|decision))?|use (?:the )?workhorse(?:\s+model)?|go back to (?:workhorse|decision)|simpler model|↓\s*(?:workhorse|planning|decision)?)\b/i;

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

/** Map a display/session role onto the climb. Tooling and Decision are not rungs. */
export function asClimbRole(role: HierarchyRole | undefined, resolved: ResolvedRuntime): LadderRole {
	if (role === "planning" || role === "frontier" || role === "workhorse") {
		if (role === "frontier" && !frontierBound(resolved)) {
			return roleAvailable(resolved, "planning") ? "planning" : startLadderRole(resolved);
		}
		return role;
	}
	return startLadderRole(resolved);
}

export function frontierBound(resolved: ResolvedRuntime): boolean {
	const assignment = resolved.roles.frontier;
	if (!assignment) {
		return false;
	}
	if (assignment.source !== "api") {
		return true;
	}
	return resolved.effectiveMode !== "local";
}

/** Frontier consult, or Planning when no third id is bound. */
export function frontierConsultRole(resolved: ResolvedRuntime): { role: LadderRole; aliased: boolean } {
	if (frontierBound(resolved)) {
		return { role: "frontier", aliased: false };
	}
	if (roleAvailable(resolved, "planning")) {
		return { role: "planning", aliased: true };
	}
	return { role: startLadderRole(resolved), aliased: true };
}

export function roleAvailable(resolved: ResolvedRuntime, role: LadderRole): boolean {
	if (role === "frontier") {
		return frontierBound(resolved);
	}
	return Boolean(resolved.roles[role]);
}

/** Lowest assigned climb role. Local/hybrid start on Workhorse. */
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
		if (candidate === "frontier") {
			const consult = frontierConsultRole(resolved);
			if (consult.aliased && consult.role !== current && roleAvailable(resolved, consult.role)) {
				return consult.role;
			}
		}
	}
	return undefined;
}

/** Next weaker climb role that exists, or undefined at Workhorse. */
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
 * `frontier` with no bound Frontier aliases Planning.
 * Use descalate to move down. Tooling is never a climb target.
 */
export function resolveEscalateTarget(
	current: LadderRole,
	requested: LadderRole | "next",
	resolved: ResolvedRuntime,
): LadderRole | undefined {
	if (requested === "next") {
		return nextLadderRole(current, resolved);
	}
	if (requested === "frontier") {
		const consult = frontierConsultRole(resolved);
		if (consult.role === current) {
			return undefined;
		}
		if (isHigherLadderRole(current, consult.role) && roleAvailable(resolved, consult.role)) {
			return consult.role;
		}
		return nextLadderRole(current, resolved);
	}
	if (isHigherLadderRole(current, requested) && roleAvailable(resolved, requested)) {
		return requested;
	}
	return nextLadderRole(current, resolved);
}

/**
 * Named descalate only moves down; "next" drops one step; "decision" is the floor.
 * From Workhorse, next is Decision. Tooling is not a drop target.
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
		return prevLadderRole(current, resolved) ?? "decision";
	}
	if (isLowerLadderRole(current, requested) && roleAvailable(resolved, requested)) {
		return requested;
	}
	return prevLadderRole(current, resolved) ?? "decision";
}

export function parseDelegateAsk(text: string): DelegateAsk | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	if (/"action"\s*:\s*"delegate"/i.test(trimmed) && /"target"\s*:\s*"tooling"/i.test(trimmed)) {
		const why = trimmed.match(/"reason"\s*:\s*"((?:\\.|[^"\\])*)"/i)?.[1];
		return {
			target: "tooling",
			why: (why ?? "runner job").replace(/\\"/g, '"').trim() || "runner job",
			explicit: true,
		};
	}
	if (DELEGATE_JSON.test(trimmed) || DELEGATE_LOOSE.test(trimmed)) {
		return { target: "tooling", why: "delegate to tooling", explicit: /delegate/i.test(trimmed) };
	}
	return undefined;
}

export function parseEscalateAsk(text: string): EscalateAsk | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	if (parseDescalateAsk(trimmed) || parseDelegateAsk(trimmed)) {
		return undefined;
	}
	const layered = layerEscalateAsk(trimmed);
	if (layered) {
		return layered;
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
		if (raw === "next" || isLadderRole(raw)) {
			return { requested: raw, why, explicit: true };
		}
		return undefined;
	}
	if (USER_DESCALATE.test(trimmed)) {
		if (/\bdecision\b/i.test(trimmed)) {
			return { requested: "decision", why: "user requested descalation", explicit: true };
		}
		const named = trimmed.match(/\b(workhorse|planning)\b/i)?.[1]?.toLowerCase();
		return {
			requested: named && isLadderRole(named) ? named : "next",
			why: "user requested descalation",
			explicit: true,
		};
	}
	if (SIMPLE_AGAIN.test(trimmed)) {
		if (/\bdecision\b|new topic|switched (?:task|topic)/i.test(trimmed)) {
			return { requested: "decision", why: "model reported topic reset", explicit: false };
		}
		const named = trimmed.match(/\bworkhorse\b/i)?.[0]?.toLowerCase();
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
	const aliased = ask.requested === "frontier" && tier !== "frontier";
	return { tier, why: ask.why, explicit: ask.explicit, ...(aliased ? { aliased: true } : {}) };
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
		default:
			return 0.35;
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

function layerEscalateAsk(text: string): EscalateAsk | undefined {
	if (!/"action"\s*:\s*"escalate"/i.test(text)) {
		return undefined;
	}
	const decision = parseLayerDecision(text);
	if (decision.action !== "escalate") {
		return undefined;
	}
	const target = decision.target;
	if (target === "tooling" || target === "script" || target === "verifier" || target === "workhorse") {
		return undefined;
	}
	if (target === "planning" || target === "frontier") {
		return { requested: target, why: decision.reason, explicit: true };
	}
	return { requested: "next", why: decision.reason, explicit: true };
}
