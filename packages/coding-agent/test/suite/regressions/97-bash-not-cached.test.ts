/**
 * Same-prompt bash must re-run after a file change; do not replay the first result.
 * Run: node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/97-bash-not-cached.test.ts --reporter=verbose
 */

import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

describe("regression #97: bash is not cached across edits", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("re-executes the same bash command after the file changes", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "out.txt", content: "Vdrain_max\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("bash", { command: "cat out.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("write", { path: "out.txt", content: "Vds_max Ipkpk\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("bash", { command: "cat out.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run twice");

		const bashTexts = harness.session.messages
			.filter((message) => message.role === "toolResult")
			.filter((message) => message.toolName === "bash")
			.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
		expect(bashTexts).toHaveLength(2);
		expect(bashTexts[0]).toMatch(/Vdrain_max/);
		expect(bashTexts[1]).toMatch(/Vds_max Ipkpk/);
		expect(bashTexts[1]).not.toMatch(/Already completed earlier in this prompt/);
		expect(bashTexts.some((text) => text.includes("[idempotent]"))).toBe(false);
	});
});
