import { checkLaw0PostFlight, evaluateLaws } from "./laws.ts";
import type { SafetyEnv, SafetyVerdict, ToolCallDescriptor } from "./types.ts";

/**
 * Pre-flight + post-flight safety gate around tool calls (SPECS_SAFETY_HARNESS §4.2).
 *
 * v1 is a deterministic rules pass (HALT off-switch + Laws hierarchy). It runs separately
 * from the planner context. An optional small classifier-prompt pass (hybrid) is tracked
 * as backlog (issue #13) and would layer on top of this verdict.
 */
export class SafetyChecker {
	/**
	 * Evaluate a tool call before it executes. Returns a verdict; callers block execution
	 * and surface `reason` as a visible conflict message when `allowed` is false.
	 */
	async checkToolCall(descriptor: ToolCallDescriptor, env: SafetyEnv): Promise<SafetyVerdict> {
		// HALT / off-switch takes precedence over everything: no tool runs while halted (§8).
		if (env.halted) {
			return {
				allowed: false,
				law: 3,
				reason: "Halted by operator (HALT): no further tool calls until resumed.",
			};
		}

		return evaluateLaws(descriptor, env);
	}

	/**
	 * Evaluate a mutating tool's result after it executed (post-flight, issues #1/#2).
	 * The action already happened, so a violation is surfaced as a visible warning
	 * (`reason`) rather than blocked; callers append it to the tool result.
	 */
	checkToolResult(descriptor: ToolCallDescriptor, resultText: string): SafetyVerdict {
		const law0 = checkLaw0PostFlight(descriptor, resultText);
		if (law0) {
			return { allowed: false, law: 0, reason: law0 };
		}
		return { allowed: true };
	}
}
