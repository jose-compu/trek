import type { PolicyCheckResult } from "./types.ts";

const DESTRUCTIVE_BASH =
	/\brm\s+-rf\b|\brm\s+-fr\b|\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b|drop\s+database|push\s+--force\b/i;

/** Static policy constraints (SPECS §9). Evaluated before Intend proceeds to Act. */
export function checkPolicyConstraints(task: string, requireDestructiveConfirm = false): PolicyCheckResult {
	const normalized = task.trim();
	if (!normalized) {
		return { allowed: false, reason: "Empty task rejected by policy constraints." };
	}

	if (DESTRUCTIVE_BASH.test(normalized) && !requireDestructiveConfirm) {
		return {
			allowed: false,
			reason: "Destructive shell pattern blocked (e.g. rm -rf) without explicit confirmation flag.",
		};
	}

	if (/\b(malware|exfiltrat|steal\s+credentials)\b/i.test(normalized)) {
		return { allowed: false, reason: "Task appears harmful and was blocked by policy constraints." };
	}

	return { allowed: true };
}
