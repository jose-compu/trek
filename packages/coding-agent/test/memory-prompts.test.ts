/**
 * Prompt-level memory checks with faux model replies. No network.
 * Run: npx vitest --run test/memory-prompts.test.ts --reporter=verbose
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditStepRecord } from "../src/core/reproducibility/types.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

function toolText(harness: Harness, name: string): string {
	return harness.session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === name)
		.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
		.join("\n");
}

describe("memory prompts", () => {
	it("stores a lesson from a mock reply and a new session recalls it", async () => {
		const first = await createHarness();
		harnesses.push(first);
		mkdirSync(join(first.tempDir, ".git"));
		writeFileSync(join(first.tempDir, "package.json"), "{}\n");
		first.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("remember", { text: "The billing export must stay in integer cents", tag: "billing" })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Stored the billing lesson."),
		]);
		await first.session.prompt("Remember this lesson: the billing export must stay in integer cents.");
		expect(toolText(first, "remember")).toMatch(/stored project:/);

		const second = await createHarness({ cwd: first.tempDir });
		harnesses.push(second);
		second.setResponses([
			fauxAssistantMessage([fauxToolCall("recall", { query: "billing export cents" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("The export stays in integer cents."),
		]);
		await second.session.prompt("What did we decide about the billing export?");
		expect(second.session.systemPrompt).toContain("integer cents");
		expect(toolText(second, "recall")).toContain("integer cents");
		const steps = second.sessionManager.getAuditSteps<AuditStepRecord>();
		expect(steps.some((step) => step.retrievedLessonIds.length > 0)).toBe(true);
	});

	it("answers a prompt with memory disabled and does not inject or index", async () => {
		const harness = await createHarness({ settings: { memory: { enabled: false } } });
		harnesses.push(harness);
		mkdirSync(join(harness.tempDir, ".git"));
		writeFileSync(join(harness.tempDir, "package.json"), "{}\n");
		writeFileSync(join(harness.tempDir, "note.txt"), "disabled-index-token\n");
		expect(harness.session.getActiveToolNames()).not.toContain("remember");
		expect(harness.session.formatMemoryStatus()).toBe("memory=off");
		harness.setResponses([fauxAssistantMessage("Memory is not in use.")]);
		await harness.session.prompt("Remember this lesson: disabled-index-token.");
		expect(harness.session.systemPrompt).not.toContain("<memory>");
		expect(harness.session.systemPrompt).not.toContain("disabled-index-token");
		expect(await harness.session.searchMemory("disabled-index-token")).toEqual([]);
	});

	it("indexes a thinking trace from a mock reply without keeping it in the next session", async () => {
		const first = await createHarness();
		harnesses.push(first);
		const thinking = "The billing export must stay in integer cents because floating currency drifts.";
		first.setResponses([
			fauxAssistantMessage([fauxThinking(thinking), fauxText("Use integer cents in the export.")]),
		]);
		await first.session.prompt("Why keep the billing export in integer cents?");
		const hits = await first.session.searchMemory(thinking);
		expect(hits.some((hit) => hit.kind === "thinking" && hit.text.includes("floating currency"))).toBe(true);

		const second = await createHarness({ cwd: first.tempDir });
		harnesses.push(second);
		second.setResponses([fauxAssistantMessage("I do not have that reasoning.")]);
		await second.session.prompt("Recall the reasoning about integer cents.");
		expect(second.session.systemPrompt).not.toContain("floating currency");
	});
});
