import { describe, expect, it } from "vitest";
import {
	detectTopicReset,
	isKeepGoingPrompt,
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

	it("keeps capability questions about internet on the same topic", () => {
		expect(isNewTopic("what is the weather in paris?", "do you have internet access?")).toBe(false);
		expect(isNewTopic("fetch https://example.com", "are you online")).toBe(false);
	});

	it("does not treat ladder navigation as a new topic", () => {
		const tetris = "please build a tetris game in js and start locally, first do the Plan";
		expect(isNewTopic(tetris, "move to frontier model")).toBe(false);
		expect(isNewTopic(tetris, "scalate layering to frontier grok model")).toBe(false);
		expect(isNewTopic(tetris, "use workhorse")).toBe(false);
		expect(detectTopicReset(tetris, "move to frontier model").reset).toBe(false);
		expect(
			detectTopicReset(
				"descalate to tooling model and grep the log",
				"swith to planning model to plan a trip to eiffel tower pls",
			).reset,
		).toBe(false);
		expect(detectTopicReset("", "use planning")).toEqual({ reset: false });
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

	it("keeps a later milestone on the same long task", () => {
		expect(
			isNewTopic("start building pls v6", "create a plan to complete the release and start working on the plan"),
		).toBe(false);
		expect(
			isNewTopic("ok read plan and build it", "load autopilot skill and continue until you complete the whole v6"),
		).toBe(false);
		expect(isKeepGoingPrompt("build a plan in a local .txt file for full v6 version")).toBe(false);
		expect(
			detectTopicReset("start building pls v6", "build a plan in a local .txt file for full v6 version").reset,
		).toBe(false);
	});

	it("keeps unrelated follow-ups sticky until an explicit reset", () => {
		expect(
			isNewTopic(
				"Fix the typo in the title of README.md on disk",
				"Design a REST API for inventory with Postgres and Redis caching",
			),
		).toBe(false);
		expect(
			detectTopicReset("Write a hello world script that prints the date", "Explain how TCP handshakes work").reset,
		).toBe(false);
	});

	it("detects done-then-new", () => {
		const reset = detectTopicReset("Thanks, that is all", "Write a haiku about rain");
		expect(reset.reset).toBe(true);
		expect(reset.reason).toBe("done-then-new");
	});
});
