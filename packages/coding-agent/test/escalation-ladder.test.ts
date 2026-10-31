/**
 * Ladder climb unit tests (no llama.cpp).
 * Run: npx vitest run test/escalation-ladder.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	defaultRuntimeConfig,
	formatEscalateCard,
	nextLadderRole,
	parseEscalateAsk,
	parseEscalateSignal,
	resolveEscalateTarget,
	resolveRuntime,
	selectSessionRole,
	selectThinkRole,
	startLadderRole,
	stripEscalateSignal,
	withHierarchy,
} from "../src/core/runtime/index.ts";

function localResolved() {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
		frontier: null,
	});
}

function hybridResolved() {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "hybrid", suite: "mistral" }), {
		frontier: { provider: "xai", modelId: "grok-4" },
	});
}

describe("escalation ladder", () => {
	it("starts on Tooling and climbs Tooling → Workhorse → Planning (local)", () => {
		const resolved = localResolved();
		expect(startLadderRole(resolved)).toBe("tooling");
		expect(nextLadderRole("tooling", resolved)).toBe("workhorse");
		expect(nextLadderRole("workhorse", resolved)).toBe("planning");
		expect(nextLadderRole("planning", resolved)).toBeUndefined();
		expect(formatEscalateCard("tooling", "workhorse", "need stronger act")).toBe(
			"↑ tooling → workhorse · need stronger act",
		);
	});

	it("climbs Planning → Frontier only when hybrid Frontier exists", () => {
		const local = localResolved();
		const hybrid = hybridResolved();
		expect(nextLadderRole("planning", local)).toBeUndefined();
		expect(nextLadderRole("planning", hybrid)).toBe("frontier");
		expect(resolveEscalateTarget("planning", "frontier", local)).toBeUndefined();
		expect(resolveEscalateTarget("planning", "frontier", hybrid)).toBe("frontier");
	});

	it("honors explicit escalate JSON and refuses demotion", () => {
		const resolved = localResolved();
		expect(parseEscalateAsk('{"escalate":"next","why":"stuck"}')).toEqual({
			requested: "next",
			why: "stuck",
			explicit: true,
		});
		expect(parseEscalateSignal('{"escalate":"planning","why":"design"}', "tooling", resolved)?.tier).toBe("planning");
		const pretty = '```json\n{\n  "escalate": "next",\n  "why": "needs plan"\n}\n```';
		expect(parseEscalateAsk(pretty)?.requested).toBe("next");
		expect(parseEscalateSignal(pretty, "tooling", resolved)?.tier).toBe("workhorse");
		// Tiny Tooling models sometimes omit the opening brace.
		expect(parseEscalateAsk('escalate":"workhorse"')?.requested).toBe("workhorse");
		expect(parseEscalateSignal('escalate":"workhorse"', "tooling", resolved)?.tier).toBe("workhorse");
		// Same-or-lower named tier still climbs one step.
		expect(resolveEscalateTarget("workhorse", "tooling", resolved)).toBe("planning");
		expect(resolveEscalateTarget("workhorse", "workhorse", resolved)).toBe("planning");
		expect(stripEscalateSignal('done\n{"escalate":"next","why":"x"}\nmore')).toBe("done\n\nmore");
	});

	it("soft stuck phrases ask for the next tier", () => {
		const resolved = localResolved();
		const soft = parseEscalateSignal("I am stuck deciding the architecture", "tooling", resolved);
		expect(soft).toMatchObject({ tier: "workhorse", explicit: false });
	});

	it("session bind climbs when elevateTo is set; think only at planning+", () => {
		const resolved = localResolved();
		expect(selectSessionRole({ text: "list files", resolved }).role).toBe("tooling");
		expect(selectSessionRole({ text: "list files", resolved, elevateTo: "workhorse" }).role).toBe("workhorse");
		expect(selectSessionRole({ text: "list files", resolved, elevateTo: "planning" }).role).toBe("planning");
		expect(selectThinkRole({ text: "list files", resolved })).toBeUndefined();
		expect(selectThinkRole({ text: "list files", resolved, elevateTo: "workhorse" })).toBeUndefined();
		expect(selectThinkRole({ text: "list files", resolved, elevateTo: "planning" })?.role).toBe("planning");
	});

	it("simulates a Tooling failure then explicit Planning ask for a hard decision", () => {
		const hybrid = hybridResolved();
		let floor = startLadderRole(hybrid);
		expect(floor).toBe("tooling");

		// Two tool failures → next
		const afterFail = resolveEscalateTarget(floor, "next", hybrid);
		expect(afterFail).toBe("workhorse");
		floor = afterFail!;

		// Workhorse still stuck on architecture → planning
		const afterStuck = parseEscalateSignal("I am stuck on the architecture", floor, hybrid);
		expect(afterStuck?.tier).toBe("planning");
		floor = afterStuck!.tier;

		// Planning asks for Frontier on a deep bug
		const toFrontier = parseEscalateSignal(
			'{"escalate":"frontier","why":"distributed consensus tradeoffs"}',
			floor,
			hybrid,
		);
		expect(toFrontier?.tier).toBe("frontier");
		expect(formatEscalateCard("planning", "frontier", toFrontier?.why)).toMatch(/↑ planning → frontier/);
	});
});
