/**
 * 0.17.0 #113: faux-provider wall-clock for one user-facing turn.
 * Run: npx vitest --run test/performance-baselines.test.ts --reporter=verbose
 */

import { performance } from "node:perf_hooks";
import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { assertUnderBudget } from "./performance-budgets.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

async function timeMs(fn: () => Promise<void>): Promise<number> {
	const started = performance.now();
	await fn();
	return performance.now() - started;
}

describe("0.17 performance baselines (faux provider)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("records first-prompt and reflective-loop wall clock", async () => {
		const first = await createHarness();
		harnesses.push(first);
		first.setResponses([fauxAssistantMessage("ok")]);
		const firstPromptMs = await timeMs(() => first.session.prompt("hello"));
		expect(firstPromptMs).toBeGreaterThan(0);
		assertUnderBudget("first_prompt_ms", firstPromptMs);

		const looped = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(looped);
		looped.setResponses([fauxAssistantMessage("ok")]);
		const reflectiveLoopMs = await timeMs(() => looped.session.prompt("hello"));
		expect(reflectiveLoopMs).toBeGreaterThan(0);
		assertUnderBudget("reflective_loop_ms", reflectiveLoopMs);

		const payload = {
			kind: "trek-e2e-wall-clock",
			version: 1,
			provider: "faux",
			first_prompt_ms: Number(firstPromptMs.toFixed(1)),
			reflective_loop_ms: Number(reflectiveLoopMs.toFixed(1)),
		};
		process.stdout.write(`METRIC first_prompt_ms=${payload.first_prompt_ms}\n`);
		process.stdout.write(`METRIC reflective_loop_ms=${payload.reflective_loop_ms}\n`);
		process.stdout.write(`${JSON.stringify(payload)}\n`);
	});
});
