/**
 * Decision Index unit tests (no Liquid API, no llama).
 * Run: npx vitest run test/decision-index.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import {
	applyDecisionQuestions,
	buildDecisionRequest,
	defaultRuntimeConfig,
	formatDecisionSolveCard,
	needsInventedTemplate,
	parseInventedDecisionTemplate,
	resolveRuntime,
	runDecisionIndex,
	selectDecisionTemplate,
	withHierarchy,
} from "../src/core/runtime/index.ts";

function localResolved() {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "lfm" }), {
		frontier: null,
	});
}

describe("decision index", () => {
	it("solves sentiment in JSON without escalating to Tooling", async () => {
		const resolved = localResolved();
		const prompt = 'give sentiment of this twit in json "the world is good"';
		expect(selectDecisionTemplate(prompt).template.id).toBe("sentiment-pulse");
		expect(buildDecisionRequest(prompt).questions.sentiment?.type).toBe("choice");
		const result = await runDecisionIndex({ text: prompt, resolved });
		expect(result.outcome).toBe("solve");
		expect(result.why).toBe("reading the room");
		expect(result.answer).toContain('"sentiment"');
		expect(result.answer).toContain("positive");
		expect(formatDecisionSolveCard("reading the room")).toBe("· decision · solve · reading the room");
	});

	it("picks tweet-weather when the ask is a social post without 'sentiment'", () => {
		expect(selectDecisionTemplate('rate this tweet "meh"').template.id).toBe("tweet-weather");
	});

	it("escalates when the turn needs tools", async () => {
		const resolved = localResolved();
		const result = await runDecisionIndex({
			text: "Fix the typo in README.md on disk",
			resolved,
		});
		expect(result.outcome).toBe("escalate");
		expect(result.route).toBe("tooling");
	});

	it("escalates open chat that is not a structured decision", async () => {
		const resolved = localResolved();
		const result = await runDecisionIndex({
			text: "Explain how TCP handshakes work in detail",
			resolved,
		});
		expect(result.outcome).toBe("escalate");
		expect(result.route).toBe("tooling");
	});

	it("asks Tooling to invent a template when no canned pack fits", async () => {
		const resolved = localResolved();
		const prompt = "Which planet is hotter, Venus or Mercury? Answer as JSON.";
		expect(needsInventedTemplate(prompt, "route-ladder", false)).toBe(true);
		const result = await runDecisionIndex({
			text: prompt,
			resolved,
			inventTemplate: async () =>
				JSON.stringify({
					id: "orbit-duel",
					title: "Orbit — who burns hotter",
					flourish: "checking the thermometers",
					solvable: true,
					state: "Venus vs Mercury surface temperature",
					primary: "hotter",
					questions: {
						hotter: {
							type: "choice",
							instructions: "Which planet has the hotter surface?",
							criteria: {
								venus: "Venus — thick atmosphere greenhouse",
								mercury: "Mercury — closer to the sun",
								tie: "Roughly the same",
							},
						},
					},
				}),
		});
		expect(result.outcome).toBe("solve");
		expect(result.source).toBe("tooling-invent");
		expect(result.templateId).toBe("orbit-duel");
		expect(result.answer).toContain("venus");
		expect(result.why).toBe("checking the thermometers");
	});

	it("parses and applies an invented pack", () => {
		const invented = parseInventedDecisionTemplate(
			{
				id: "spice-rack",
				title: "Spice — heat check",
				flourish: "tasting the air",
				primary: "heat",
				state: "this salsa is fiery hot",
				questions: {
					heat: {
						type: "choice",
						instructions: "How spicy?",
						criteria: { mild: "Gentle", hot: "Fiery burn", nuclear: "Unbearable" },
					},
				},
			},
			"fallback",
		);
		expect(invented?.id).toBe("spice-rack");
		const applied = applyDecisionQuestions(invented!.state, invented!.questions, invented!.primary);
		expect(applied.primaryValue).toBe("hot");
	});
});
