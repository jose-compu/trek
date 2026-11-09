/**
 * Long-task pin: resume after a milestone yield.
 * Run: npx vitest run test/long-task.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	classifyLongTaskResume,
	isLongTaskKeepAlive,
	isLongTaskPrompt,
	longTaskContinuePrompt,
	looksLikeLongTaskControlNoise,
	looksLikeLongTaskDone,
	looksLikePartialMilestone,
	pinLongTaskGoal,
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

	it("keeps the prior goal when the user only says continue", () => {
		expect(isLongTaskKeepAlive("continue")).toBe(true);
		expect(isLongTaskKeepAlive("continue with tasks pls")).toBe(true);
		expect(isLongTaskKeepAlive("keep going")).toBe(true);
		expect(isLongTaskKeepAlive("load autopilot skill and continue until you complete the whole v6")).toBe(false);
		expect(isLongTaskKeepAlive("start building pls v6")).toBe(false);
		expect(
			pinLongTaskGoal({
				prompt: "continue with tasks pls",
				previousGoal: "ship the vdf patch",
				previousTask: "continue with tasks pls",
			}),
		).toBe("ship the vdf patch");
		expect(pinLongTaskGoal({ prompt: "continue", previousTask: "fix the webpack plugin" })).toBe(
			"fix the webpack plugin",
		);
		expect(pinLongTaskGoal({ prompt: "ship v1.3.1 on the patch branch" })).toBe("ship v1.3.1 on the patch branch");
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
		expect(looksLikeLongTaskDone("Patch ready for the maintainer publish step.")).toBe(true);
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
		const follow = longTaskContinuePrompt("complete the whole v6");
		expect(follow).toMatch(/Do not stop after one commit/);
		expect(follow).toMatch(/Original request/);
		expect(follow).not.toMatch(/"escalate"/);
		expect(follow).not.toMatch(/"descalate"/);
		expect(follow).not.toMatch(/"delegate"/);
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: partial,
				queued: false,
				hold: true,
			}),
		).toBe(false);
	});

	it("does not resume a control-JSON echo loop", () => {
		const echo =
			'Escalation noted.\n$ echo \'{"descalate":"workhorse","why":"simple again"}\'\n{"descalate":"workhorse","why":"simple again"}';
		expect(looksLikeLongTaskControlNoise(echo)).toBe(true);
		expect(classifyLongTaskResume(echo).kind).toBe("drop");
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: "Escalation noted for the publish step.\n<honesty>\nconfidence: medium\n</honesty>",
				queued: false,
			}),
		).toBe(false);
		expect(looksLikeLongTaskControlNoise('{"escalate":"planning","why":"stuck"}')).toBe(true);
		expect(
			shouldResumeLongTask({
				pinned: true,
				assistantText: '{"escalate":"planning","why":"stuck"}',
				queued: false,
			}),
		).toBe(true);
		expect(looksLikeLongTaskControlNoise("Bumped versions to 1.3.1 and updated CHANGELOG.")).toBe(false);
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
