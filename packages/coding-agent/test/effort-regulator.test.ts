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

	it("stops when the same command fails with the same errors", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const fail = fauxAssistantMessage(
			[
				fauxToolCall("bash", {
					command: "printf '%s\\n' 'error: Peano/Basic.lean:38:14: unsolved goals'; exit 1",
				}),
			],
			{ stopReason: "toolUse" },
		);
		harness.setResponses([fail, fail, fauxAssistantMessage("should-not-run")]);

		await harness.session.prompt("build twice");

		const texts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(texts.some((text) => text.includes("EffortRegulator stopped: same errors."))).toBe(true);
		expect(texts.filter((text) => text.includes("error: Peano/Basic.lean:38:14: unsolved goals")).length).toBe(2);
		expect(harness.getPendingResponseCount()).toBe(1);
	});

	it("stops the fourth failure of one command even when the errors change", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const command =
			'n=$(cat .n 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > .n; printf "error: Peano.lean:%s:1: unsolved goals\\n" "$n"; exit 1';
		const steps = Array.from({ length: EFFORT_REPEAT_LIMIT }, () => [
			fauxAssistantMessage([fauxToolCall("read", { path: "Peano.lean" })], { stopReason: "toolUse" as const }),
			fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" as const }),
		]).flat();
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "Peano.lean", content: "x\n" })], {
				stopReason: "toolUse",
			}),
			...steps,
			fauxAssistantMessage("should-not-run"),
		]);

		await harness.session.prompt("rebuild");

		const texts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(texts.some((text) => text.includes("EffortRegulator stopped: same command failed."))).toBe(true);
		expect(texts.some((text) => text.includes("error: Peano.lean:1:1: unsolved goals"))).toBe(true);
		expect(texts.some((text) => text.includes("error: Peano.lean:4:1: unsolved goals"))).toBe(true);
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

	it("continues the same repeats when effort is loose", async () => {
		const harness = await createHarness({ settings: { effort: "loose" } });
		harnesses.push(harness);
		const repeat = fauxAssistantMessage([fauxToolCall("bash", { command: "echo effort-loose" })], {
			stopReason: "toolUse",
		});
		harness.setResponses([
			...Array.from({ length: EFFORT_REPEAT_LIMIT }, () => repeat),
			fauxAssistantMessage("continued"),
		]);

		await harness.session.prompt("repeat under loose effort");

		const texts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(texts.some((text) => text.includes("EffortRegulator stopped"))).toBe(false);
		expect(harness.session.getEffort()).toBe("loose");
		expect(
			harness.session.messages.some(
				(message) =>
					message.role === "assistant" &&
					message.content.some((part) => part.type === "text" && part.text.includes("continued")),
			),
		).toBe(true);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("does not stop for effort when the setting is off", async () => {
		const harness = await createHarness({ settings: { effort: "off" } });
		harnesses.push(harness);
		const repeat = fauxAssistantMessage([fauxToolCall("bash", { command: "echo effort-off" })], {
			stopReason: "toolUse",
		});
		harness.setResponses([
			...Array.from({ length: EFFORT_REPEAT_LIMIT }, () => repeat),
			fauxAssistantMessage("continued"),
		]);

		await harness.session.prompt("repeat with effort off");

		const texts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(texts.some((text) => text.includes("EffortRegulator stopped"))).toBe(false);
		expect(harness.session.getEffort()).toBe("off");
		const steps = harness.sessionManager.getAuditSteps<{ effort?: string }>();
		expect(steps.at(-1)?.effort).toBe("off");
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
