/**
 * Control grammar + layer intent (no live Decision).
 * Run: npx vitest run test/layer-intent.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	classifyLayerIntentHeuristic,
	isControlPrompt,
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
	});
});
