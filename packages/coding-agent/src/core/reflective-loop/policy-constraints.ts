import { evaluateTaskLaws } from "../safety/laws.ts";
import type { PolicyCheckResult } from "./types.ts";

/**
 * Static policy constraints evaluated before Intend proceeds to Act.
 *
 * 0.4.0 (issue #3): PolicyConstraints and the Laws hierarchy are one implementation —
 * this delegates to the same law patterns used by the pre-flight SafetyChecker, so the
 * reflective loop and the tool boundary cannot drift apart.
 */
export function checkPolicyConstraints(task: string, requireDestructiveConfirm = false): PolicyCheckResult {
	const verdict = evaluateTaskLaws(task, requireDestructiveConfirm);
	return { allowed: verdict.allowed, reason: verdict.reason, law: verdict.law };
}
