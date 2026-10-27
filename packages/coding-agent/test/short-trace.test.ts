import { describe, expect, it } from "vitest";
import {
	apiShortTraceFixture,
	applyShortTraceContext,
	applyShortTraceOptions,
	localShortTraceFixture,
	SHORT_TRACE_MAX_TOKENS,
	SHORT_TRACE_SECTION,
	spanWithinCap,
	tokensBeforeTool,
} from "../src/core/runtime/short-trace.ts";

describe("short thinking traces", () => {
	it("asks an API model for a minimal reasoning effort and a 128 token budget", () => {
		const context = applyShortTraceContext({
			systemPrompt: "You are Trek.",
			tools: [{ name: "write" }],
		});
		const options = applyShortTraceOptions({ reasoning: "high" as const, thinkingBudgets: { high: 8000 } }, true);

		expect(context.systemPrompt?.startsWith(SHORT_TRACE_SECTION)).toBe(true);
		expect(options.reasoning).toBe("minimal");
		expect(options.thinkingBudgets?.minimal).toBe(SHORT_TRACE_MAX_TOKENS);
		expect(options.thinkingBudgets?.high).toBe(SHORT_TRACE_MAX_TOKENS);

		const events = apiShortTraceFixture();
		expect(events.some((event) => event.type === "tool")).toBe(true);
		expect(tokensBeforeTool(events)).toBeLessThanOrEqual(SHORT_TRACE_MAX_TOKENS);
		expect(spanWithinCap(events)).toBe(true);
	});

	it("keeps a local fixture inside the cap without a thinking channel", () => {
		const context = applyShortTraceContext({
			systemPrompt: "Local suite",
			tools: [{ name: "bash" }],
		});
		const options = applyShortTraceOptions(undefined, true);

		expect(context.systemPrompt).toContain("## Short trace");
		expect(context.systemPrompt).toContain("128 tokens");
		expect(options.reasoning).toBeUndefined();
		expect(options.thinkingBudgets?.minimal).toBe(128);

		const events = localShortTraceFixture();
		expect(events[0]?.type).toBe("text");
		expect(events.some((event) => event.type === "tool")).toBe(true);
		expect(tokensBeforeTool(events)).toBeLessThanOrEqual(SHORT_TRACE_MAX_TOKENS);
		expect(spanWithinCap(events)).toBe(true);
	});
});
