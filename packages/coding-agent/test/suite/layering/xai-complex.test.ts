/**
 * Static Grok replies for the complex layering prompts.
 * Fixtures are checked-in xAI envelopes (no live key in CI).
 * Refresh: XAI_API_KEY=… node scripts/capture-xai-layering.mjs
 * Run: npx vitest run test/suite/layering/xai-complex.test.ts --reporter=verbose
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	applyAutoLayering,
	classifyTask,
	defaultRuntimeConfig,
	detectTopicReset,
	isLadderNavPrompt,
	layerDecisionTextFromEnvelope,
	loadCatalogFixture,
	parseDelegateAsk,
	parseDescalateAsk,
	parseEscalateAsk,
	parseNewTopicSignal,
	selectSessionRole,
	shouldAutoDelegateLiveNetwork,
	stripEscalateSignal,
} from "../../../src/core/runtime/index.ts";
import { needsLiveNetwork } from "../../../src/core/runtime/layer-network.ts";
import { resolveRuntime } from "../../../src/core/runtime/resolve.ts";
import { loadLayeringCase } from "./load-fixture.ts";

const catalogs = join(dirname(fileURLToPath(import.meta.url)), "fixtures/catalogs");

const PACKS = [
	["workhorse", "stay-calc"],
	["tooling", "live-weather"],
	["tooling", "grep-log"],
	["planning", "race-debug"],
	["frontier", "consult-migrate"],
	["workhorse", "mechanical-rename"],
	["workhorse", "defect-fix-escalate"],
	["workhorse", "capability-net"],
	["workhorse", "http-server"],
	["workhorse", "tetris-build"],
	["workhorse", "descalate-workhorse"],
	["workhorse", "new-topic-haiku"],
	["workhorse", "go-back-to-decision"],
	["planning", "use-planning"],
	["planning", "plan-done-descalate"],
	["frontier", "move-to-frontier"],
	["decision", "format-yes-no"],
	["planning", "hypotheses-fanout"],
	["workhorse", "handoff-brief-join"],
	["tooling", "parallel-runners"],
] as const;

function replyMove(text: string): { reply: string; replyTarget?: string } {
	const delegate = parseDelegateAsk(text);
	if (delegate) {
		return { reply: "delegate", replyTarget: delegate.target };
	}
	const down = parseDescalateAsk(text);
	if (down) {
		return { reply: "descalate", replyTarget: String(down.requested) };
	}
	const up = parseEscalateAsk(text, "model");
	if (up?.explicit) {
		return { reply: "escalate", replyTarget: up.requested };
	}
	return { reply: "none" };
}

describe("xAI complex layering fixtures", () => {
	const layered = resolveRuntime(
		applyAutoLayering(defaultRuntimeConfig(), loadCatalogFixture(join(catalogs, "xai.json"))),
	);

	it("maps Fast/mid/coding/multi-agent on auto", () => {
		expect(layered.layering).toBe("auto");
		expect(layered.roles.decision?.id).toBe("grok-4.1-fast");
		expect(layered.roles.tooling?.id).toBe("grok-4.1-fast");
		expect(layered.roles.workhorse?.id).toBe("grok-4.3");
		expect(layered.roles.planning?.id).toBe("grok-4.5");
		expect(layered.roles.frontier?.id).toBe("grok-4.20-multi-agent");
	});

	for (const [role, pack] of PACKS) {
		it(`${role}/${pack}`, () => {
			const loaded = loadLayeringCase("xai", role, pack);
			const prompt = loaded.prompt.trim();
			const text = layerDecisionTextFromEnvelope("xai", loaded.response);
			const classified = classifyTask(prompt);
			const selected = selectSessionRole({ text: prompt, resolved: layered });
			const move = replyMove(text);
			expect(classified.kind, prompt).toBe(loaded.expect.kind);
			expect(selected.role, prompt).toBe(loaded.expect.startRole);
			expect(selected.modelId).toBe(loaded.expect.boundId);
			expect(move.reply, text).toBe(loaded.expect.reply);
			if (loaded.expect.reply !== "none") {
				expect(move.replyTarget).toBe(loaded.expect.replyTarget);
			}
			expect(needsLiveNetwork(prompt)).toBe(loaded.expect.liveNetwork);
			expect(shouldAutoDelegateLiveNetwork(prompt, layered)).toBe(loaded.expect.autoDelegate);
			expect(stripEscalateSignal(text)).not.toMatch(/"descalate"|"escalate"|"action"\s*:\s*"delegate"/);
		});
	}

	it("does not treat first-do-the-Plan as a user climb; Grok’s reply does", () => {
		const loaded = loadLayeringCase("xai", "workhorse", "tetris-build");
		expect(parseEscalateAsk(loaded.prompt.trim())?.explicit).toBeFalsy();
		expect(parseEscalateAsk(layerDecisionTextFromEnvelope("xai", loaded.response))).toMatchObject({
			requested: "planning",
			explicit: true,
		});
	});

	it("binds Frontier on move-to-frontier prompts", () => {
		expect(selectSessionRole({ text: "move to frontier model", resolved: layered })).toMatchObject({
			role: "frontier",
			modelId: "grok-4.20-multi-agent",
		});
		expect(selectSessionRole({ text: "scalate layering to frontier grok model", resolved: layered }).role).toBe(
			"frontier",
		);
	});

	it("capability reply does not descalate or new-topic", () => {
		const loaded = loadLayeringCase("xai", "workhorse", "capability-net");
		const text = layerDecisionTextFromEnvelope("xai", loaded.response);
		expect(parseDescalateAsk(text)).toBeUndefined();
		expect(parseEscalateAsk(text)).toBeUndefined();
		expect(text).toMatch(/bash/i);
	});

	it("prompt 8 descalate then new-topic haiku resets the floor", () => {
		const drop = loadLayeringCase("xai", "workhorse", "descalate-workhorse");
		const haiku = loadLayeringCase("xai", "workhorse", "new-topic-haiku");
		expect(isLadderNavPrompt(drop.prompt)).toBe(true);
		expect(parseDescalateAsk(drop.prompt.trim())).toMatchObject({ requested: "workhorse", explicit: true });
		expect(isLadderNavPrompt(haiku.prompt)).toBe(false);
		expect(detectTopicReset(drop.prompt, haiku.prompt)).toMatchObject({ reset: true, reason: "explicit" });
		expect(parseNewTopicSignal(haiku.prompt)).toBeUndefined();
	});

	it("go back to decision is a user descalate, not a model control line", () => {
		const loaded = loadLayeringCase("xai", "workhorse", "go-back-to-decision");
		expect(parseDescalateAsk(loaded.prompt.trim())).toMatchObject({ requested: "decision", explicit: true });
		expect(parseDescalateAsk(layerDecisionTextFromEnvelope("xai", loaded.response))).toBeUndefined();
	});

	it("use planning and move to frontier are ladder nav, not a new topic", () => {
		const planning = loadLayeringCase("xai", "planning", "use-planning");
		const frontier = loadLayeringCase("xai", "frontier", "move-to-frontier");
		expect(isLadderNavPrompt(planning.prompt)).toBe(true);
		expect(isLadderNavPrompt(frontier.prompt)).toBe(true);
		expect(detectTopicReset("the same edit failed twice", planning.prompt).reset).toBe(false);
		expect(detectTopicReset("use planning", frontier.prompt).reset).toBe(false);
	});
});
