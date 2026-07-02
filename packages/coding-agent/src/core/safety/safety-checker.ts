import { evaluateLaws } from "./laws.ts";
import type { SafetyEnv, SafetyVerdict, ToolCallDescriptor } from "./types.ts";

/**
 * Pre-flight safety gate around tool calls (SPECS_SAFETY_HARNESS §4.2).
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
}
