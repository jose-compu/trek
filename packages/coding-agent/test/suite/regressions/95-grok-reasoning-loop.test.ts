/**
 * Grok 4.6 reasoning loop must stop the agent and must not auto-retry (#95).
 * Run: node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/95-grok-reasoning-loop.test.ts --reporter=verbose
 */

import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

describe("regression #95: Grok reasoning loop is not retried", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("does not auto-retry a repetitive thinking loop error", async () => {
		const harness = await createHarness({
			settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "Model entered a repetitive thinking loop; generation stopped.",
			}),
			fauxAssistantMessage("should not run"),
		]);

		await harness.session.prompt("continue the project");

		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
		const last = [...harness.session.messages].reverse().find((message) => message.role === "assistant");
		expect(last?.stopReason).toBe("error");
		expect(last?.errorMessage).toMatch(/repetitive thinking loop/i);
	});
});
