/**
 * Ladder climb unit tests (no llama.cpp).
 * Run: npx vitest run test/escalation-ladder.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	asClimbRole,
	climbHandoffBrief,
	defaultRuntimeConfig,
	formatDelegateCard,
	formatDescalateCard,
	formatEscalateCard,
	frontierConsultRole,
	isToolArgumentValidationError,
	nextLadderRole,
	parseDelegateAsk,
	parseDescalateAsk,
	parseDescalateSignal,
	parseEscalateAsk,
	parseEscalateSignal,
	planningBriefPrompt,
	prevLadderRole,
	resolveDescalateTarget,
	resolveEscalateTarget,
	resolveRuntime,
	selectSessionRole,
	selectThinkRole,
	startLadderRole,
	stripEscalateSignal,
	withHierarchy,
	withRoleOverride,
} from "../src/core/runtime/index.ts";

function localResolved() {
	return resolveRuntime(
		withHierarchy(defaultRuntimeConfig(), { mode: "local", layering: "manual", suite: "mistral" }),
		{
			frontier: null,
		},
	);
}

function hybridResolved() {
	return resolveRuntime(
		withHierarchy(defaultRuntimeConfig(), { mode: "hybrid", layering: "manual", suite: "mistral" }),
		{
			frontier: { provider: "xai", modelId: "grok-4" },
		},
	);
}

describe("escalation ladder", () => {
	it("starts on Workhorse and climbs Workhorse → Planning (local)", () => {
		const resolved = localResolved();
		expect(startLadderRole(resolved)).toBe("workhorse");
		expect(nextLadderRole("workhorse", resolved)).toBe("planning");
		expect(nextLadderRole("planning", resolved)).toBeUndefined();
		expect(formatEscalateCard("workhorse", "planning", "need stronger act")).toBe(
			"↑ workhorse → planning · need stronger act",
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

	it("starts on Workhorse when layering is single", () => {
		const resolved = resolveRuntime(
			withHierarchy(defaultRuntimeConfig(), { mode: "local", layering: "single", suite: "mistral" }),
			{ frontier: null },
		);
		expect(startLadderRole(resolved)).toBe("workhorse");
		expect(nextLadderRole("workhorse", resolved)).toBeUndefined();
	});

	it("climbs to a local Frontier assignment in local mode", () => {
		const resolved = resolveRuntime(
			withRoleOverride(
				withHierarchy(defaultRuntimeConfig(), { mode: "local", layering: "manual", suite: "mistral" }),
				"frontier",
				{ source: "local", id: "Ministral-3-8B-Reasoning-2512", thinking: "deep" },
			),
			{ frontier: null },
		);
		expect(nextLadderRole("planning", resolved)).toBe("frontier");
		expect(resolveEscalateTarget("planning", "frontier", resolved)).toBe("frontier");
	});

	it("honors explicit escalate JSON and refuses demotion", () => {
		const resolved = localResolved();
		expect(parseEscalateAsk('{"escalate":"next","why":"stuck"}')).toEqual({
			requested: "next",
			why: "stuck",
			explicit: true,
		});
		expect(parseEscalateSignal('{"escalate":"planning","why":"design"}', "workhorse", resolved)?.tier).toBe(
			"planning",
		);
		const pretty = '```json\n{\n  "escalate": "next",\n  "why": "needs plan"\n}\n```';
		expect(parseEscalateAsk(pretty)?.requested).toBe("next");
		expect(parseEscalateSignal(pretty, "workhorse", resolved)?.tier).toBe("planning");
		expect(parseEscalateAsk('escalate":"planning"')?.requested).toBe("planning");
		expect(parseEscalateSignal('escalate":"planning"', "workhorse", resolved)?.tier).toBe("planning");
		expect(resolveEscalateTarget("workhorse", "workhorse", resolved)).toBe("planning");
		expect(stripEscalateSignal('done\n{"escalate":"next","why":"x"}\nmore')).toBe("done\n\nmore");
	});

	it("soft stuck phrases ask for the next tier", () => {
		const resolved = localResolved();
		const soft = parseEscalateSignal("I am stuck deciding the architecture", "workhorse", resolved);
		expect(soft).toMatchObject({ tier: "planning", explicit: false });
	});

	it("in-tier answers do not escalate", () => {
		const resolved = localResolved();
		const answers = [
			"OK",
			"42",
			"yes",
			"A",
			"s.toUpperCase()",
			"src/index.ts",
			"Fixed the typo in the title.",
			"Use option A because latency is the priority.",
			// Tiny models refuse elevation in prose — must not soft-climb.
			"Escalate to tooling? No.\n(No command ran.)\nThe edit was successful.",
		];
		for (const text of answers) {
			expect(parseEscalateAsk(text), text).toBeUndefined();
			expect(parseEscalateSignal(text, "workhorse", resolved), text).toBeUndefined();
		}
	});

	it("session bind climbs when elevateTo is set; think only at planning+", () => {
		const resolved = localResolved();
		expect(selectSessionRole({ text: "list files", resolved }).role).toBe("workhorse");
		expect(selectSessionRole({ text: "list files", resolved, elevateTo: "workhorse" }).role).toBe("workhorse");
		expect(selectSessionRole({ text: "list files", resolved, elevateTo: "planning" }).role).toBe("planning");
		expect(selectThinkRole({ text: "list files", resolved })).toBeUndefined();
		expect(selectThinkRole({ text: "list files", resolved, elevateTo: "workhorse" })).toBeUndefined();
		expect(selectThinkRole({ text: "list files", resolved, elevateTo: "planning" })?.role).toBe("planning");
	});

	it("simulates Workhorse stuck then Planning consult of Frontier", () => {
		const hybrid = hybridResolved();
		let floor = startLadderRole(hybrid);
		expect(floor).toBe("workhorse");

		const afterStuck = parseEscalateSignal("I am stuck on the architecture", floor, hybrid);
		expect(afterStuck?.tier).toBe("planning");
		floor = afterStuck!.tier;

		const toFrontier = parseEscalateSignal(
			'{"escalate":"frontier","why":"distributed consensus tradeoffs"}',
			floor,
			hybrid,
		);
		expect(toFrontier?.tier).toBe("frontier");
		expect(formatEscalateCard("planning", "frontier", toFrontier?.why)).toMatch(/↑ planning → frontier/);
	});

	it("treats schema validation failures as immediate escalate signals", () => {
		const writeMissingPath = `Validation failed for tool "write":
  - path: must have required properties path

Received arguments:
{
  "content": "const now = new Date();"
}`;
		expect(isToolArgumentValidationError(writeMissingPath)).toBe(true);
		expect(isToolArgumentValidationError("bash: command not found: foo")).toBe(false);
		expect(isToolArgumentValidationError("File not found: src/x.ts")).toBe(false);
	});

	it("drops Planning → Workhorse on descalate and refuses escalate demotion", () => {
		const resolved = localResolved();
		expect(prevLadderRole("planning", resolved)).toBe("workhorse");
		expect(prevLadderRole("workhorse", resolved)).toBeUndefined();
		expect(resolveDescalateTarget("planning", "workhorse", resolved)).toBe("workhorse");
		expect(resolveDescalateTarget("planning", "next", resolved)).toBe("workhorse");
		expect(resolveDescalateTarget("workhorse", "next", resolved)).toBe("decision");
		expect(parseDescalateAsk('{"descalate":"workhorse","why":"simple typo"}')).toEqual({
			requested: "workhorse",
			why: "simple typo",
			explicit: true,
		});
		expect(parseDescalateSignal('{"descalate":"next","why":"easy edit"}', "planning", resolved)?.tier).toBe(
			"workhorse",
		);
		expect(parseDescalateSignal("hand off to tooling", "planning", resolved)).toBeUndefined();
		expect(parseEscalateAsk('{"descalate":"workhorse","why":"x"}')).toBeUndefined();
		expect(stripEscalateSignal('done\n{"descalate":"next","why":"x"}\nmore')).toBe("done\n\nmore");
		expect(formatDescalateCard("planning", "workhorse", "simple typo")).toBe("↓ planning → workhorse · simple typo");
	});

	it("does not climb to Tooling; delegate+tooling is a runner", () => {
		const resolved = localResolved();
		expect(parseEscalateAsk('{"escalate":"tooling","why":"search"}')).toBeUndefined();
		expect(parseEscalateSignal('{"escalate":"tooling","why":"search"}', "workhorse", resolved)).toBeUndefined();
		expect(asClimbRole("tooling", resolved)).toBe("workhorse");
		expect(parseDelegateAsk('{"action":"delegate","target":"tooling","reason":"grep the log"}')).toEqual({
			target: "tooling",
			why: "grep the log",
			explicit: true,
		});
		expect(parseDelegateAsk("hand off to tooling")?.target).toBe("tooling");
		expect(parseEscalateAsk("hand off to tooling")).toBeUndefined();
		expect(formatDelegateCard("workhorse", "live fetch")).toBe("→ workhorse ⇄ tooling · live fetch");
	});

	it("aliases Frontier consult to Planning when no third id is bound", () => {
		const local = localResolved();
		expect(frontierConsultRole(local)).toEqual({ role: "planning", aliased: true });
		expect(resolveEscalateTarget("workhorse", "frontier", local)).toBe("planning");
		expect(parseEscalateSignal('{"escalate":"frontier","why":"consult"}', "workhorse", local)).toMatchObject({
			tier: "planning",
			aliased: true,
		});
		expect(resolveEscalateTarget("planning", "frontier", local)).toBeUndefined();
	});

	it("parses LayerDecision escalate with evidence and builds a handoff brief", () => {
		const resolved = localResolved();
		const text = JSON.stringify({
			action: "escalate",
			target: "planning",
			confidence: "high",
			reason: "two failed fixes",
			evidence: ["write missing path", "second retry failed"],
		});
		expect(parseEscalateSignal(text, "workhorse", resolved)?.tier).toBe("planning");
		expect(climbHandoffBrief("two failed fixes")).toMatchObject({
			goal: "continue the task",
			tried: "two failed fixes",
			evidence: ["two failed fixes"],
			openQuestion: "two failed fixes",
		});
		const empty = JSON.stringify({
			action: "escalate",
			target: "planning",
			confidence: "low",
			reason: "guess",
			evidence: [],
		});
		expect(parseEscalateAsk(empty)).toBeUndefined();
		const prompt = planningBriefPrompt("fix the login", "two failed fixes", climbHandoffBrief("two failed fixes"));
		expect(prompt).toMatch(/Handoff brief:/);
		expect(prompt).toMatch(/tried: two failed fixes/);
		expect(prompt).toMatch(/Do not repeat a failed command/);
	});
});
