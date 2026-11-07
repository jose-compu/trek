/**
 * Mix-vendor verifier. Off until bound. Irreversible tools keep 0.4/0.13 gates.
 */

import type { LayerDecision } from "./layer-decision.ts";
import type { RoleAssignment, RuntimeRole } from "./types.ts";

const VERIFIER_GATED = /\b(deploy|delete|rm\s+-r|drop\s+database|force-push|external send|curl\s+https?:\/\/)\b/i;

export function verifierBound(roles: Partial<Record<RuntimeRole, RoleAssignment>>): boolean {
	return Boolean(roles.verifier);
}

export function verifierAllows(decision: LayerDecision | undefined): boolean {
	return decision?.action === "verify" && decision.confidence === "high";
}

export function toolNeedsVerifier(toolName: string, args: Record<string, unknown>, verifierOn: boolean): boolean {
	if (!verifierOn) {
		return false;
	}
	if (toolName === "bash") {
		const command = typeof args.command === "string" ? args.command : "";
		return VERIFIER_GATED.test(command);
	}
	return false;
}

export function verifierBlockReason(decision: LayerDecision | undefined): string {
	if (verifierAllows(decision)) {
		return "";
	}
	return "Verifier on: typed verdict required before deploy/delete/external send.";
}

/** One high-confidence verify covers the next gated tool only. */
export function consumeVerifierGrant(decision: LayerDecision | undefined): {
	allowed: boolean;
	remaining?: LayerDecision;
} {
	if (!verifierAllows(decision)) {
		return { allowed: false, remaining: decision };
	}
	return { allowed: true };
}

/** A later non-verify LayerDecision invalidates a pending grant. */
export function pendingVerifierDecision(
	current: LayerDecision | undefined,
	incoming: LayerDecision | undefined,
): LayerDecision | undefined {
	if (!incoming) {
		return current;
	}
	return incoming.action === "verify" ? incoming : undefined;
}
