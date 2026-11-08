/**
 * Control grammar + layer intent (no live Decision).
 * Run: npx vitest run test/layer-intent.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	classifyLayerIntentHeuristic,
	isControlPrompt,
	isKeepGoingPrompt,
	isLongTaskPrompt,
	parseControlAsk,
	parseLayerIntentReply,
	shouldAskDecisionIntent,
} from "../src/core/runtime/index.ts";

describe("layer control grammar", () => {
	it("pins climb, drop, and tooling from one verb+role grammar", () => {
		expect(parseControlAsk("use planning")).toEqual({
			kind: "climb",
			role: "planning",
			why: "user requested elevation",
		});
		expect(parseControlAsk("swith to planning model to plan a trip to eiffel tower pls")).toMatchObject({
			kind: "climb",
			role: "planning",
		});
		expect(parseControlAsk("scalate layering to frontier grok model")).toMatchObject({
			kind: "climb",
			role: "frontier",
		});
		expect(parseControlAsk("descalate to tooling model and grep the log")).toEqual({
			kind: "delegate",
			why: "delegate to tooling",
		});
		expect(parseControlAsk("use workhorse")).toMatchObject({ kind: "drop", role: "workhorse" });
		expect(parseControlAsk("go back to decision")).toMatchObject({ kind: "drop", role: "decision" });
		expect(isControlPrompt("/escalate")).toBe(true);
		expect(parseControlAsk("/escalate")).toBeUndefined();
		expect(parseControlAsk("build a tetris game in js")).toBeUndefined();
		expect(parseControlAsk("consult only")).toMatchObject({ kind: "climb", role: "frontier" });
		expect(parseControlAsk("Please consult only the README")).toBeUndefined();
	});
});

describe("layer intent", () => {
	it("parses a Decision JSON reply", () => {
		expect(parseLayerIntentReply('{"intent":"same-topic"}')).toBe("same-topic");
		expect(parseLayerIntentReply('noise {"intent":"new-topic"} trailing')).toBe("new-topic");
		expect(parseLayerIntentReply('{"intent":"planning"}')).toBe("planning");
		expect(parseLayerIntentReply("no json")).toBeUndefined();
	});

	it("heuristic never auto-climbs to planning", () => {
		expect(classifyLayerIntentHeuristic("", "plan a trip to the eiffel tower")).toBe("workhorse");
		expect(classifyLayerIntentHeuristic("grep the log", "plan a trip to the eiffel tower")).toBe("same-topic");
		expect(classifyLayerIntentHeuristic("fix the typo", "what is the weather in paris?")).toBe("tooling");
	});

	it("asks Decision only in the old Jaccard zone", () => {
		expect(
			shouldAskDecisionIntent(
				"descalate to tooling model and grep the log for the last error",
				"plan a trip to the eiffel tower for three nights",
			),
		).toBe(true);
		expect(shouldAskDecisionIntent("fix the typo", "also fix the second typo")).toBe(false);
		expect(
			shouldAskDecisionIntent("grep the log", "swith to planning model to plan a trip to eiffel tower pls"),
		).toBe(false);
		expect(
			shouldAskDecisionIntent(
				"start building pls v6 of lacan-scan on the release branch",
				"create a plan to complete the release and start working on the plan",
			),
		).toBe(false);
		expect(
			shouldAskDecisionIntent(
				"ok read plan and build it for the remaining v6 detectors",
				"load autopilot skill and continue until you complete the whole v6",
			),
		).toBe(false);
	});

	it("treats build continuations as keep-going, not a Decision park", () => {
		expect(isKeepGoingPrompt("continue")).toBe(true);
		expect(isKeepGoingPrompt("start building")).toBe(true);
		expect(isKeepGoingPrompt("create a plan to complete the release and start working on the plan")).toBe(true);
		expect(isKeepGoingPrompt("ok read plan and build it")).toBe(true);
		expect(isKeepGoingPrompt("new task: write a haiku about rain")).toBe(false);
		expect(isLongTaskPrompt("load autopilot skill and continue until you complete the whole v6")).toBe(true);
		expect(isLongTaskPrompt("continue")).toBe(true);
		expect(isLongTaskPrompt("start building pls v6")).toBe(true);
	});
});
