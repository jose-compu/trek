/**
 * Long-task pin: resume after a milestone yield.
 * Run: npx vitest run test/long-task.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	classifyLongTaskResume,
	isLongTaskPrompt,
	longTaskContinuePrompt,
	looksLikeLongTaskDone,
	looksLikePartialMilestone,
	shouldResumeLongTask,
} from "../src/core/runtime/index.ts";

describe("long task pin", () => {
	it("pins continue and start-building language", () => {
		expect(isLongTaskPrompt("load autopilot skill and continue until you complete the whole v6")).toBe(true);
		expect(isLongTaskPrompt("don't stop until v6 is done")).toBe(true);
		expect(isLongTaskPrompt("continue")).toBe(true);
		expect(isLongTaskPrompt("start building pls v6")).toBe(true);
		expect(isLongTaskPrompt("what is 2+2")).toBe(false);
	});

	it("resumes after a milestone yield and stops when the task is done", () => {
		const partial =
			"Bumped versions to 6.0.0. Committed and pushed.\n\nNext: tag v6.0.0.\n<honesty>\nconfidence: medium\n</honesty>";
		expect(looksLikePartialMilestone(partial)).toBe(true);
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: partial,
				queued: false,
			}),
		).toBe(true);
		expect(looksLikeLongTaskDone("v6.0.0 is complete. Release published.")).toBe(true);
		expect(looksLikeLongTaskDone("AIS208 stub is complete. Next: wire Crisp.")).toBe(false);
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: "v6.0.0 is complete. Release published.",
				queued: false,
			}),
		).toBe(false);
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: partial,
				queued: false,
			}),
		).toBe(true);
		expect(longTaskContinuePrompt("complete the whole v6")).toMatch(/Do not stop after one commit/);
		expect(longTaskContinuePrompt("complete the whole v6")).toMatch(/escalate/);
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: partial,
				queued: false,
				hold: true,
			}),
		).toBe(false);
	});

	it("switches models mid-task and ignores a Decision park", () => {
		expect(classifyLongTaskResume('{"escalate":"planning","why":"stuck on the release graph"}')).toEqual({
			kind: "climb",
			requested: "planning",
			why: "stuck on the release graph",
		});
		expect(classifyLongTaskResume('{"action":"delegate","target":"tooling","reason":"grep the log"}')).toEqual({
			kind: "delegate",
			why: "grep the log",
		});
		expect(classifyLongTaskResume('{"descalate":"workhorse","why":"mechanical remaining"}')).toEqual({
			kind: "drop",
			requested: "workhorse",
			why: "mechanical remaining",
		});
		expect(classifyLongTaskResume('{"descalate":"decision","why":"new topic"}')).toEqual({ kind: "stay" });
		expect(classifyLongTaskResume('{"new_topic":true,"why":"milestone"}')).toEqual({ kind: "stay" });
		expect(classifyLongTaskResume("I am stuck and need a stronger model")).toEqual({ kind: "stay" });
	});
});
