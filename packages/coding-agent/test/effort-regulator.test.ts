/**
 * Live EffortRegulator stop (0.9.0).
 * Run: npx vitest run test/effort-regulator.test.ts --reporter=verbose
 */

import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	EFFORT_NO_PROGRESS_LIMIT,
	EFFORT_REPEAT_LIMIT,
	EffortRegulator,
} from "../src/core/reflective-loop/effort-regulator.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("effort regulator", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("stops the turn when the same action repeats", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const repeat = fauxAssistantMessage([fauxToolCall("bash", { command: "echo effort-repeat" })], {
			stopReason: "toolUse",
		});
		harness.setResponses([
			...Array.from({ length: EFFORT_REPEAT_LIMIT }, () => repeat),
			fauxAssistantMessage("should-not-run"),
		]);

		await harness.session.prompt("repeat the same command");

		const texts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(texts.some((text) => text.includes("EffortRegulator stopped: repeated action."))).toBe(true);
		expect(
			harness.session.messages.some(
				(message) =>
					message.role === "assistant" &&
					message.content.some((part) => part.type === "text" && part.text === "should-not-run"),
			),
		).toBe(false);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("keeps going when each error reports something new", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const misses = Array.from({ length: EFFORT_NO_PROGRESS_LIMIT }, (_, index) =>
			fauxAssistantMessage([fauxToolCall("read", { path: `missing-${index}.lean` })], { stopReason: "toolUse" }),
		);
		harness.setResponses([
			...misses,
			fauxAssistantMessage([fauxToolCall("write", { path: "fixed.lean", content: "ok\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("inspect then write");

		const texts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(texts.some((text) => text.includes("EffortRegulator stopped: no progress."))).toBe(false);
		expect(texts.some((text) => text.includes("Successfully wrote"))).toBe(true);
	});

	it("stops after several steps with no progress", () => {
		const regulator = new EffortRegulator();
		for (let step = 0; step < EFFORT_NO_PROGRESS_LIMIT - 1; step++) {
			regulator.updateProgress(`step:${step}`, false);
		}
		expect(regulator.shouldContinue()).toBe(true);
		regulator.updateProgress("step:last", false);
		expect(regulator.stopReason()).toBe("EffortRegulator stopped: no progress.");
	});

	it("stops when the prompt budget is spent", () => {
		const regulator = new EffortRegulator();
		regulator.setCostBudget(1);
		regulator.recordCost(1);
		expect(regulator.stopReason()).toBe("EffortRegulator stopped: spent budget.");
	});
});
