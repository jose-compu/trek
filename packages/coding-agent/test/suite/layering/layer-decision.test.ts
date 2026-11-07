/**
 * LayerDecision faux harness (issue #191, D26).
 * Run: npx vitest run test/suite/layering/layer-decision.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	HANDOFF_BRIEF_JSON_SCHEMA,
	jsonSchemaHasLengthKeywords,
	LAYER_DECISION_JSON_SCHEMA,
	LAYER_JOIN,
	LAYER_SUBTASK_RESULT_JSON_SCHEMA,
	layerDecisionTextFromEnvelope,
	parseDecisionRoute,
	parseHandoffBrief,
	parseLayerDecision,
	parseLayerSubtaskResult,
	SAFE_LAYER_DECISION,
} from "../../../src/core/runtime/layer-decision.ts";
import { loadLayeringCase } from "./load-fixture.ts";

describe("LayerDecision schema", () => {
	it("is vendor-safe: no minLength or maxItems keywords", () => {
		expect(jsonSchemaHasLengthKeywords(LAYER_DECISION_JSON_SCHEMA)).toBe(false);
		expect(jsonSchemaHasLengthKeywords(HANDOFF_BRIEF_JSON_SCHEMA)).toBe(false);
		expect(jsonSchemaHasLengthKeywords(LAYER_SUBTASK_RESULT_JSON_SCHEMA)).toBe(false);
	});

	it("retries once on bad JSON then uses the safe default", () => {
		let calls = 0;
		const parsed = parseLayerDecision("not json", () => {
			calls += 1;
			return "still broken";
		});
		expect(calls).toBe(1);
		expect(parsed).toEqual(SAFE_LAYER_DECISION);
	});

	it("accepts a valid retry body", () => {
		const parsed = parseLayerDecision("nope", () =>
			JSON.stringify({
				action: "continue",
				target: "workhorse",
				thinking: "brief",
				confidence: "medium",
				reason: "retry filled the schema",
				evidence: ["second pass"],
			}),
		);
		expect(parsed.action).toBe("continue");
		expect(parsed.evidence).toEqual(["second pass"]);
	});

	it("turns empty-evidence escalate into ask_human", () => {
		const parsed = parseLayerDecision(
			JSON.stringify({
				action: "escalate",
				target: "planning",
				thinking: "deep",
				confidence: "medium",
				reason: "stuck",
				evidence: [],
			}),
		);
		expect(parsed.action).toBe("ask_human");
		expect(parsed.reason).toMatch(/empty evidence/);
	});

	it("does not let Decision route to Tooling", () => {
		const routed = parseDecisionRoute(
			JSON.stringify({
				action: "continue",
				target: "tooling",
				confidence: "high",
				reason: "grep the log",
				evidence: ["path"],
			}),
		);
		expect(routed.target).toBe("workhorse");
		expect(routed.action).toBe("continue");
	});
});

describe("handoff brief and LayerSubtaskResult", () => {
	it("parses the five-field brief", () => {
		const brief = parseHandoffBrief({
			goal: "find the leak",
			constraints: "do not rewrite the module",
			tried: "two patches",
			evidence: ["test.log:41"],
			openQuestion: "which handle stays open?",
		});
		expect(brief?.goal).toBe("find the leak");
		expect(brief?.openQuestion).toMatch(/handle/);
	});

	it("joins a subtask as layer_join or halts after retry", () => {
		const ok = parseLayerSubtaskResult(
			JSON.stringify({
				join: LAYER_JOIN,
				status: "ok",
				workflow: "layer-hypotheses",
				output: "theory B",
				evidence: ["repro"],
				winner: "theory-b",
			}),
		);
		expect(ok.status).toBe("ok");
		expect(ok.winner).toBe("theory-b");
		const halted = parseLayerSubtaskResult("{", () => "nope");
		expect(halted.status).toBe("halt");
		expect(halted.join).toBe(LAYER_JOIN);
	});
});

describe("faux envelopes", () => {
	it("openai decision-route", () => {
		const pack = loadLayeringCase("openai", "decision", "decision-route");
		expect(pack.prompt).toMatch(/format/);
		const text = layerDecisionTextFromEnvelope("openai", pack.response);
		const decision = parseDecisionRoute(text);
		expect(decision).toMatchObject(pack.expect);
		expect(decision.target).not.toBe("tooling");
	});

	it("xai decision-route", () => {
		const pack = loadLayeringCase("xai", "decision", "decision-route");
		const text = layerDecisionTextFromEnvelope("xai", pack.response);
		expect(parseDecisionRoute(text)).toMatchObject(pack.expect);
	});

	it("glm decision-route", () => {
		const pack = loadLayeringCase("glm", "decision", "decision-route");
		const text = layerDecisionTextFromEnvelope("glm", pack.response);
		expect(parseDecisionRoute(text)).toMatchObject(pack.expect);
	});

	it("kimi decision-route", () => {
		const pack = loadLayeringCase("kimi", "decision", "decision-route");
		const text = layerDecisionTextFromEnvelope("kimi", pack.response);
		expect(parseDecisionRoute(text)).toMatchObject(pack.expect);
	});

	it("anthropic planning-escalate rejects empty evidence", () => {
		const pack = loadLayeringCase("anthropic", "planning", "planning-escalate");
		const text = layerDecisionTextFromEnvelope("anthropic", pack.response);
		expect(parseLayerDecision(text)).toMatchObject(pack.expect);
	});

	it("qwen bad-json retries then defaults", () => {
		const pack = loadLayeringCase("qwen", "workhorse", "bad-json");
		const text = layerDecisionTextFromEnvelope("qwen", pack.response);
		expect(parseLayerDecision(text, () => "still bad")).toMatchObject(pack.expect);
	});

	it("liquid-d1 decision-route maps choice to script|workhorse", () => {
		const pack = loadLayeringCase("liquid-d1", "decision", "decision-route");
		const text = layerDecisionTextFromEnvelope("liquid-d1", pack.response);
		expect(parseDecisionRoute(text)).toMatchObject(pack.expect);
	});

	it.skip("scripts dialect has no chat completion (no model)", () => {
		// Scripts are recipes/bash. Pack lands with C4 route rewrite.
	});
});
