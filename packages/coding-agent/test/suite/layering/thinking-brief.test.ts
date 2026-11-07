/**
 * /thinking briefly and compact card. #108 128-token floor remains.
 * Run: npx vitest run test/suite/layering/thinking-brief.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { layerDecisionTextFromEnvelope, parseLayerDecision } from "../../../src/core/runtime/layer-decision.ts";
import {
	apiShortTraceFixture,
	applyShortTraceOptions,
	SHORT_TRACE_MAX_TOKENS,
	spanWithinCap,
	tokensBeforeTool,
} from "../../../src/core/runtime/short-trace.ts";
import {
	BRIEF_THINKING_VIEWPORT_LINES,
	effectiveThinkingPin,
	parseThinkingCommand,
	runThinkingCommand,
	thinkingCardTitle,
	thinkingCardViewport,
	thinkingLevelForPin,
} from "../../../src/core/runtime/thinking-brief.ts";
import { loadLayeringCase } from "./load-fixture.ts";

describe("/thinking briefly", () => {
	it("parses briefly, deep, and off", () => {
		expect(parseThinkingCommand("briefly")).toEqual({ pin: "brief" });
		expect(parseThinkingCommand("brief")).toEqual({ pin: "brief" });
		expect(parseThinkingCommand("deep")).toEqual({ pin: "deep" });
		expect(parseThinkingCommand("off")).toEqual({ pin: "off" });
		expect(parseThinkingCommand("")).toEqual({ status: true });
		expect(parseThinkingCommand("loud")).toMatchObject({ error: expect.stringMatching(/Usage/) });
	});

	it("pins briefly until deep or off", () => {
		const brief = runThinkingCommand(undefined, "briefly");
		expect(brief.pin).toBe("brief");
		expect(brief.message).toMatch(/thinking briefly/);
		expect(runThinkingCommand("brief", "deep").pin).toBe("deep");
		expect(runThinkingCommand("deep", "off").pin).toBe("off");
	});

	it("maps brief to minimal and deep to high", () => {
		expect(thinkingLevelForPin("brief")).toBe("minimal");
		expect(thinkingLevelForPin("deep")).toBe("high");
		expect(thinkingLevelForPin("off")).toBe("off");
	});

	it("uses a compact thinking briefly title and 1–2 line viewport", () => {
		expect(thinkingCardTitle("brief")).toBe("thinking briefly");
		expect(thinkingCardViewport("brief")).toBe(BRIEF_THINKING_VIEWPORT_LINES);
		expect(BRIEF_THINKING_VIEWPORT_LINES).toBeLessThanOrEqual(2);
		expect(thinkingCardTitle("deep")).toBe("thinking");
		expect(thinkingCardViewport("deep")).toBe(3);
	});

	it("lets LayerDecision.thinking brief win over a deep pin", () => {
		expect(effectiveThinkingPin("deep", "brief", "deep")).toBe("brief");
		expect(effectiveThinkingPin("brief", "deep", "off")).toBe("brief");
		expect(effectiveThinkingPin(undefined, undefined, "deep")).toBe("deep");
	});

	it("keeps the #108 128-token floor on a brief tool turn", () => {
		const options = applyShortTraceOptions({ reasoning: "high" as const }, true);
		expect(options.reasoning).toBe("minimal");
		expect(options.thinkingBudgets?.minimal).toBe(SHORT_TRACE_MAX_TOKENS);
		const events = apiShortTraceFixture();
		expect(tokensBeforeTool(events)).toBeLessThanOrEqual(SHORT_TRACE_MAX_TOKENS);
		expect(spanWithinCap(events)).toBe(true);
	});

	it("skips the #108 floor when /thinking deep is pinned", () => {
		const options = applyShortTraceOptions(
			{ reasoning: "high" as const, thinkingBudgets: { high: 8000 } },
			true,
			true,
		);
		expect(options.reasoning).toBe("high");
		expect(options.thinkingBudgets?.high).toBe(8000);
	});

	it("openai think-brief fixture is brief and calls a tool before 128 tokens", () => {
		const pack = loadLayeringCase("openai", "workhorse", "think-brief");
		expect(pack.prompt).toMatch(/tool/i);
		const text = layerDecisionTextFromEnvelope("openai", pack.response);
		const decision = parseLayerDecision(text);
		expect(decision).toMatchObject(pack.expect);
		expect(thinkingCardTitle(decision.thinking)).toBe("thinking briefly");
		expect(tokensBeforeTool(apiShortTraceFixture())).toBeLessThanOrEqual(128);
	});
});
