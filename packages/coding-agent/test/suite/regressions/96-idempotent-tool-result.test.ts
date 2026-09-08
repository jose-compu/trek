/**
 * Duplicate write/edit must not leak [idempotent] to the model (#96).
 * Run: node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/96-idempotent-tool-result.test.ts --reporter=verbose
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { convertToLlm } from "../../../src/core/messages.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("regression #96: idempotent tool results are plain language", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("replays a duplicate write without [idempotent] and without marking an error", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "once.ts", content: "a" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("write", { path: "once.ts", content: "a" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("wrote"),
		]);

		await harness.session.prompt("write twice");

		expect(readFileSync(join(harness.tempDir, "once.ts"), "utf-8")).toBe("a");
		const results = harness.session.messages.filter((message) => message.role === "toolResult");
		const texts = results.flatMap((message) =>
			message.content.filter((part) => part.type === "text").map((part) => part.text),
		);
		expect(texts.some((text) => text.includes("[idempotent]"))).toBe(false);
		expect(texts.some((text) => /already completed in this prompt/i.test(text))).toBe(true);
		expect(texts.some((text) => /Do not rewrite the file/.test(text))).toBe(true);
		expect(texts.every((text) => !/idempotent|skipped/i.test(text))).toBe(true);
		expect(results.every((message) => message.isError !== true)).toBe(true);
	});

	it("strips historical [idempotent] tags before they reach the model", () => {
		const converted = convertToLlm([
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "edit",
				content: [
					{
						type: "text",
						text: "[idempotent] Successfully replaced 1 block(s) in run_spice.py.",
					},
				],
				isError: false,
				timestamp: 1,
			},
		]);
		expect(converted).toEqual([
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "edit",
				content: [{ type: "text", text: "Successfully replaced 1 block(s) in run_spice.py." }],
				isError: false,
				timestamp: 1,
			},
		]);
	});
});
