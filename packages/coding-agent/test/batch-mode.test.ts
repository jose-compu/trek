import { describe, expect, test } from "vitest";
import { parseBatchPromptContent } from "../src/cli/batch-prompts.ts";
import { buildPromptIdByUserTimestamp, SessionManager } from "../src/core/session-manager.ts";

describe("batch mode", () => {
	test("parseBatchPromptContent splits non-empty lines", () => {
		const prompts = parseBatchPromptContent("first\n\n second \nthird\n");
		expect(prompts).toEqual(["first", "second", "third"]);
	});

	test("SessionManager assigns monotonic prompt IDs", () => {
		const manager = SessionManager.inMemory(process.cwd());
		expect(manager.getNextPromptNumber()).toBe(1);
		manager.appendPromptMeta(1, "#1", "first");
		expect(manager.getNextPromptNumber()).toBe(2);
		manager.appendPromptMeta(2, "#2", "second");
		manager.appendPromptMeta(3, "#3", "third");

		const promptEntries = manager.getEntries().filter((entry) => entry.type === "prompt_meta");
		expect(promptEntries.map((entry) => entry.promptId)).toEqual(["#1", "#2", "#3"]);
	});

	test("buildPromptIdByUserTimestamp maps prompt_meta to following user messages", () => {
		const manager = SessionManager.inMemory(process.cwd());
		manager.appendPromptMeta(1, "#1", "first");
		manager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "first" }],
			timestamp: 1000,
		});
		manager.appendPromptMeta(2, "#2", "second");
		manager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "second" }],
			timestamp: 2000,
		});

		const map = buildPromptIdByUserTimestamp(manager.getBranch());
		expect(map.get(1000)).toBe("#1");
		expect(map.get(2000)).toBe("#2");
	});
});
