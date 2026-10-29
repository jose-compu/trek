/**
 * Operator mode decides who must approve work. It does not replace the laws.
 * A forbidden action stays forbidden in every mode.
 *
 * Supervised: free and cheap tools run. A gated tool waits for one confirmation.
 * Delegated: a gated tool in the grant runs. Any other gated tool waits.
 * Checkpoint: the same tool rule as supervised, and the act phase stays closed until opened.
 * Diagnostic: only free tools run. The trace is still written.
 * Ask: the model answers. File reads and web reads run. Writes do not.
 */

import type { ReversibilityTier } from "../extensions/types.ts";
import type { ReflectivePhase } from "../reflective-loop/types.ts";

export type OperatorMode = "supervised" | "delegated" | "checkpoint" | "diagnostic" | "ask";

export type OperatorDecision = "run" | "confirm" | "block";

export const OPERATOR_MODES: readonly OperatorMode[] = ["supervised", "delegated", "checkpoint", "diagnostic", "ask"];

/** Tools an ask session may call. Writes, bash, and memory changes are not in this set. */
export const ASK_READ_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"recall",
	"webfetch",
	"web_fetch",
	"web-fetch",
	"websearch",
	"web_search",
	"web-search",
]);

export const CHECKPOINT_ACT_REASON = "Checkpoint: the act phase is closed. Open it before the agent runs.";

export function isOperatorMode(value: string): value is OperatorMode {
	return (OPERATOR_MODES as readonly string[]).includes(value);
}

export function decideTool(
	mode: OperatorMode,
	tier: ReversibilityTier,
	toolName: string,
	grant: ReadonlySet<string>,
): OperatorDecision {
	if (tier === "forbidden") return "block";
	if (mode === "diagnostic") return tier === "free" ? "run" : "block";
	if (mode === "ask") return tier === "free" || ASK_READ_TOOLS.has(toolName) ? "run" : "block";
	if (tier === "free" || tier === "cheap") return "run";
	if (mode === "delegated" && grant.has(toolName)) return "run";
	return "confirm";
}

export function operatorBlockReason(
	mode: OperatorMode,
	toolName: string,
	tier: ReversibilityTier,
	decision: OperatorDecision,
): string | undefined {
	if (decision === "run") return undefined;
	if (mode === "ask") {
		return `Ask mode: ${toolName} is blocked. This mode reads files and the web, and does not write.`;
	}
	if (mode === "diagnostic") {
		return `Diagnostic mode: ${toolName} is blocked (mutating tools are not allowed).`;
	}
	if (tier === "forbidden") return `${mode} mode: ${toolName} is forbidden.`;
	if (mode === "delegated") return `Delegated mode: ${toolName} is gated and is not in the grant.`;
	return `Supervised mode: ${toolName} is gated and waits for confirmation.`;
}

/** Checkpoint closes act until the operator opens it. The other modes leave every phase open. */
export function phaseIsOpen(
	mode: OperatorMode | undefined,
	phase: ReflectivePhase,
	openPhases: ReadonlySet<string>,
): boolean {
	if (mode !== "checkpoint") return true;
	if (phase === "observe") return true;
	if (phase !== "act") return true;
	return openPhases.has(phase);
}
