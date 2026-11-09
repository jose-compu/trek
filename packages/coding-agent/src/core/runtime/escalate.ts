/**
 * Escalation ladder: Workhorse ⇄ Planning ⇄ Frontier.
 * Tooling is a supporting runner (delegate), not a rung.
 * Climb on escalate/stuck/failures; drop on descalate or new topic (→ Decision).
 */

import { isControlPrompt, parseControlAsk } from "./layer-control.ts";
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
	/\b(this is (?:simple|easy|trivial)|simple (?:edit|fix|typo|rename)|hand off to workhorse|please descalate|descalat(?:e|ion) needed|too (?:much|heavy|strong) (?:a )?model|overkill|drop (?:to|down)|go back to (?:workhorse|decision)|new topic(?:\s+now)?|user switched (?:task|topic))\b/i;

export type DescalateTarget = LadderRole | "next" | "decision";

export function isLadderRole(value: string): value is LadderRole {
	return (ESCALATION_LADDER as readonly string[]).includes(value);
}

/** User asked to move the session between Workhorse / Planning / Frontier. */
export function isLadderNavPrompt(text: string): boolean {
	return isControlPrompt(text);
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

/** Lowest assigned climb role. Bound Workhorse starts the climb, including layered api. */
export function startLadderRole(resolved: ResolvedRuntime): LadderRole {
	if (resolved.effectiveMode === "api" && !resolved.roles.workhorse) {
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
	if (requested === current) {
		if (requested === "planning" || requested === "frontier") {
			return undefined;
		}
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
	if (isHigherLadderRole(current, requested)) {
		return nextLadderRole(current, resolved);
	}
	return undefined;
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

/**
 * After an explicit Tooling delegate, skip `selectSessionRole` bind.
 * Bind re-picks Workhorse from the user text and overwrites the footer SKU.
 */
export function shouldRebindSessionRole(turnLayerAction: string | undefined): boolean {
	return turnLayerAction !== "delegate";
}

/** API stacks skip the Decision Index. After a park, bind must announce the climb. */
export function shouldAnnounceDecisionClimb(parkedOnDecision: boolean, keepDecisionDisplay?: boolean): boolean {
	return parkedOnDecision && !keepDecisionDisplay;
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
		return { target: "tooling", why: "delegate to tooling", explicit: true };
	}
	const control = parseControlAsk(trimmed);
	if (control?.kind === "delegate") {
		return { target: "tooling", why: control.why, explicit: true };
	}
	return undefined;
}

export function parseEscalateAsk(text: string, source: "user" | "model" = "user"): EscalateAsk | undefined {
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
	if (source === "user") {
		const control = parseControlAsk(trimmed);
		if (control?.kind === "climb") {
			return { requested: control.role, why: control.why, explicit: true };
		}
		return undefined;
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
	if (parseDelegateAsk(trimmed)) {
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
	const control = parseControlAsk(trimmed);
	if (control?.kind === "drop") {
		return {
			requested: control.role,
			why: control.why,
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
	source: "user" | "model" = "model",
): EscalateSignal | undefined {
	const ask = parseEscalateAsk(text, source);
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
	let next = stripIncompleteControlTail(text);
	next = stripControlObjects(next);
	next = next
		.replace(DESCALATE_JSON, "")
		.replace(DESCALATE_LOOSE, "")
		.replace(ESCALATE_JSON, "")
		.replace(ESCALATE_LOOSE, "")
		.replace(DELEGATE_JSON, "")
		.replace(/\{\s*"new_topic"\s*:\s*true\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/gis, "")
		.replace(/```(?:json)?\s*```/gi, "");
	return next.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Weak models `echo` the control JSON instead of writing it in the assistant message.
 * That bash card must stay off-screen; the dim climb/delegate line is enough.
 */
export function looksLikeLayeringControlEcho(command: string): boolean {
	const statements = peelShellStatements(command);
	if (statements.length === 0) {
		return false;
	}
	let sawControlEcho = false;
	for (const statement of statements) {
		if (isEnvAssignment(statement)) {
			continue;
		}
		if (isControlEchoStatement(statement)) {
			sawControlEcho = true;
			continue;
		}
		return false;
	}
	return sawControlEcho;
}

function peelShellStatements(command: string): string[] {
	const out: string[] = [];
	for (const line of command.split(/\n+/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const unwrapped = unwrapDashC(trimmed);
		if (unwrapped !== trimmed) {
			out.push(...peelShellStatements(unwrapped));
			continue;
		}
		out.push(trimmed);
	}
	return out;
}

function unwrapDashC(command: string): string {
	const match = command.match(/^(?:(?:ba)?sh|zsh|dash)(?:\s+-[abefhlx]+)*\s+(?:-[abefhlx]*c[abefhlx]*|--command)\s+/i);
	if (!match) {
		return command;
	}
	const rest = command.slice(match[0].length).trim();
	const quote = rest[0];
	if ((quote === "'" || quote === '"') && rest.length >= 2 && rest.endsWith(quote)) {
		return rest.slice(1, -1);
	}
	return rest;
}

function isEnvAssignment(statement: string): boolean {
	return /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=/.test(statement);
}

function isControlEchoStatement(statement: string): boolean {
	if (!/^(?:echo|printf)\b/i.test(statement)) {
		return false;
	}
	const payload = unwrapEchoPayload(statement);
	if (!payload) {
		return false;
	}
	return payloadLooksLikeControl(payload);
}

function payloadLooksLikeControl(payload: string): boolean {
	const candidates = payload.includes('\\"') ? [payload, payload.replace(/\\"/g, '"')] : [payload];
	for (const slice of candidates) {
		if (isLayeringControl(tryJson(slice))) {
			return true;
		}
		if (stripEscalateSignal(slice).length === 0 && /"(?:escalate|descalate|action|delegate|new_topic)"/.test(slice)) {
			return true;
		}
	}
	return false;
}

function unwrapEchoPayload(command: string): string | undefined {
	const isPrintf = /^printf\b/i.test(command);
	let rest = command.replace(/^(?:echo|printf)\s+(?:-[neE]+\s+)*/i, "").trim();
	if (!rest) {
		return undefined;
	}
	if (isPrintf) {
		rest = rest.replace(/^(?:'[^']*'|"[^"]*"|\S+)\s+/, "").trim();
		if (!rest) {
			return undefined;
		}
	}
	const quote = rest[0];
	if (quote === "'" || quote === '"') {
		if (rest.length < 2 || rest[rest.length - 1] !== quote) {
			return undefined;
		}
		let inner = rest.slice(1, -1);
		if (quote === '"') {
			inner = inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
		}
		return inner.trim();
	}
	return rest.trim();
}

function isLayeringControl(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.escalate === "string" || typeof record.descalate === "string") {
		return true;
	}
	if (record.new_topic === true) {
		return true;
	}
	return record.action === "escalate" || record.action === "descalate" || record.action === "delegate";
}

function tryJson(slice: string): unknown {
	try {
		return JSON.parse(slice) as unknown;
	} catch {
		return undefined;
	}
}

function balancedObject(text: string, start: number): string | undefined {
	if (text[start] !== "{") {
		return undefined;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return undefined;
}

function stripControlObjects(text: string): string {
	const next = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (full, body: string) => {
		const trimmed = body.trim();
		const start = trimmed.indexOf("{");
		if (start < 0) {
			return full;
		}
		const slice = balancedObject(trimmed, start);
		if (!slice || !isLayeringControl(tryJson(slice))) {
			return full;
		}
		const rest = `${trimmed.slice(0, start)}${trimmed.slice(start + slice.length)}`.trim();
		return rest;
	});
	let i = 0;
	let out = "";
	while (i < next.length) {
		if (next[i] === "{") {
			const slice = balancedObject(next, i);
			if (slice && isLayeringControl(tryJson(slice))) {
				i += slice.length;
				continue;
			}
		}
		out += next[i];
		i++;
	}
	return out;
}

function stripIncompleteControlTail(text: string): string {
	const start = text.lastIndexOf("{");
	if (start < 0 || balancedObject(text, start)) {
		return text;
	}
	const tail = text.slice(start);
	if (
		/"?(?:escalate|descalate|new_topic)"?\s*:/i.test(tail) ||
		/"action"\s*:\s*"(?:escalate|descalate|delegate)"/i.test(tail)
	) {
		return text.slice(0, start).trimEnd();
	}
	return text;
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

/** One-line status when Workhorse/Planning send a runner job to Tooling. */
export function formatDelegateCard(from: HierarchyRole, why?: string): string {
	const reason = why?.trim() ? ` · ${why.trim().slice(0, 48)}` : "";
	return `→ ${from} ⇄ tooling${reason}`;
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
