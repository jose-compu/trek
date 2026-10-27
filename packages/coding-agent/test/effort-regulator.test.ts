/**
 * Live EffortRegulator stop (0.9.0).
 * Run: npx vitest run test/effort-regulator.test.ts --reporter=verbose
 */

import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { EffortRegulator } from "../src/core/reflective-loop/effort-regulator.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("effort regulator", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("stops the turn when the same action runs twice", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo effort-repeat" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo effort-repeat" })], { stopReason: "toolUse" }),
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

	it("stops after three steps with no progress", () => {
		const regulator = new EffortRegulator();
		regulator.updateProgress("read:{}", false);
		regulator.updateProgress("bash:{}", false);
		expect(regulator.shouldContinue()).toBe(true);
		regulator.updateProgress("edit:{}", false);
		expect(regulator.stopReason()).toBe("EffortRegulator stopped: no progress.");
	});

	it("stops when the prompt budget is spent", () => {
		const regulator = new EffortRegulator();
		regulator.setCostBudget(1);
		regulator.recordCost(1);
		expect(regulator.stopReason()).toBe("EffortRegulator stopped: spent budget.");
	});
});
