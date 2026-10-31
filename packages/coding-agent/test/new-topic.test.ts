import { describe, expect, it } from "vitest";
import {
	detectTopicReset,
	isNewTopic,
	parseNewTopicSignal,
	stripNewTopicSignal,
} from "../src/core/runtime/new-topic.ts";

describe("isNewTopic / detectTopicReset", () => {
	it("treats the first prompt as a new topic", () => {
		expect(isNewTopic("", "Fix the typo in README.md")).toBe(true);
		expect(detectTopicReset("", "Fix the typo in README.md").reason).toBe("first");
	});

	it("keeps follow-ups on the same file as the same topic", () => {
		expect(isNewTopic("Fix the typo in README.md", "Also fix the second typo in README.md")).toBe(false);
	});

	it("keeps short continuations on the same topic", () => {
		expect(isNewTopic("Build a chess game in index.html", "also add castling")).toBe(false);
		expect(isNewTopic("Build a chess game in index.html", "try again")).toBe(false);
	});

	it("detects an explicit new task", () => {
		expect(isNewTopic("Fix README.md typo", "new task: write a poem about mountains")).toBe(true);
		expect(detectTopicReset("Fix README.md typo", "/new-topic").reason).toBe("explicit");
		expect(detectTopicReset("Fix README.md typo", "forget that — list the files here").reason).toBe("explicit");
	});

	it("detects new_topic JSON control signal", () => {
		const text = 'ok\n{"new_topic":true,"why":"user switched"}\n';
		expect(parseNewTopicSignal(text)?.why).toBe("user switched");
		expect(detectTopicReset("old task about chess", text).reason).toBe("signal");
		expect(stripNewTopicSignal(text)).toBe("ok");
	});

	it("detects unrelated long prompts via low overlap", () => {
		expect(
			isNewTopic(
				"Fix the typo in the title of README.md on disk",
				"Design a REST API for inventory with Postgres and Redis caching",
			),
		).toBe(true);
	});

	it("detects intent shift between distinct imperatives", () => {
		const reset = detectTopicReset(
			"Write a hello world script that prints the date",
			"Explain how TCP handshakes work",
		);
		expect(reset.reset).toBe(true);
		expect(reset.reason).toBe("intent-shift");
		expect(reset.label).toBe("task changed");
	});

	it("detects done-then-new", () => {
		const reset = detectTopicReset("Thanks, that is all", "Write a haiku about rain");
		expect(reset.reset).toBe(true);
		expect(reset.reason).toBe("done-then-new");
	});
});
