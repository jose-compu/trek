/**
 * Mix-source, mix-vendor verifier, telemetry, remaining D26 packs.
 * Run: npx vitest run test/suite/layering/mix-source.test.ts --reporter=verbose
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseArchonWorkflow } from "../../../src/core/domains/archon.ts";
import { loadCatalogFixture, mapCatalogToRoles } from "../../../src/core/runtime/catalog-map.ts";
import {
	benchmarkLayering,
	createPortAllocator,
	defaultRuntimeConfig,
	formatLayerRoute,
	jsonSchemaHasLengthKeywords,
	LAYER_DECISION_JSON_SCHEMA,
	LlamaProcessManager,
	layerDecisionTextFromEnvelope,
	layerRouteTrace,
	mixVendorVerifier,
	parseLayerDecision,
	resolveRuntime,
	runLayerWorkflow,
	sessionLocalRoles,
	thinkingCardTitle,
	toolNeedsVerifier,
	verifierAllows,
	withHierarchy,
	withRoleOverride,
	writeLayeringBenchmarkJson,
} from "../../../src/core/runtime/index.ts";
import { loadLayeringCase } from "./load-fixture.ts";

const meta = join(dirname(fileURLToPath(import.meta.url)), "../../../domains/meta");

const catalogs = join(dirname(fileURLToPath(import.meta.url)), "fixtures/catalogs");

describe("mix-source", () => {
	it("honors per-role source over hierarchy.mode api", () => {
		let config = withHierarchy(defaultRuntimeConfig(), { mode: "api", layering: "manual" });
		config = withRoleOverride(config, "workhorse", {
			source: "api",
			id: "gpt-6.1-terra",
			provider: "openai",
			thinking: "brief",
		});
		config = withRoleOverride(config, "tooling", {
			source: "local",
			id: "Qwen3.5-0.8B",
			thinking: "off",
		});
		const resolved = resolveRuntime(config, { frontier: null });
		expect(resolved.effectiveMode).toBe("api");
		expect(resolved.roles.workhorse?.source).toBe("api");
		expect(resolved.roles.tooling?.source).toBe("local");
		expect(sessionLocalRoles(resolved)).toEqual(["tooling"]);
		expect(resolved.requiresHuggingFaceToken).toBe(true);
		const manager = new LlamaProcessManager({
			spawn: () => ({ pid: 7 }),
			allocatePort: createPortAllocator(18100),
			binaryAvailable: () => true,
			weightsAvailable: () => true,
		});
		expect(manager.ensure("tooling", resolved).pid).toBe(7);
		expect(() => manager.ensure("planning", resolved)).toThrow(/api mode does not start llama-server/);
	});
});

describe("mix-vendor verifier", () => {
	it("binds Grok Fast Tooling, OpenAI Workhorse, and a different-provider verifier", () => {
		const xai = mapCatalogToRoles(loadCatalogFixture(join(catalogs, "xai.json")));
		const openai = mapCatalogToRoles(loadCatalogFixture(join(catalogs, "openai.json")));
		let config = withHierarchy(defaultRuntimeConfig(), { mode: "api", layering: "manual" });
		config = withRoleOverride(config, "tooling", { ...xai.roles.tooling!, source: "api" });
		config = withRoleOverride(config, "workhorse", { ...openai.roles.workhorse!, source: "api" });
		config = withRoleOverride(config, "verifier", {
			source: "api",
			id: "claude-sonnet",
			provider: "anthropic",
			thinking: "off",
		});
		const resolved = resolveRuntime(config, { frontier: null });
		expect(resolved.roles.tooling?.provider).toBe("xai");
		expect(resolved.roles.workhorse?.provider).toBe("openai");
		expect(resolved.roles.verifier?.provider).toBe("anthropic");
		expect(mixVendorVerifier(resolved.roles)).toBe(true);
		expect(jsonSchemaHasLengthKeywords(LAYER_DECISION_JSON_SCHEMA)).toBe(false);
	});

	it("keeps 0.4/0.13 gates when verifier is unbound; requires a high verify when bound", () => {
		expect(toolNeedsVerifier("bash", { command: "deploy production" }, false)).toBe(false);
		expect(toolNeedsVerifier("bash", { command: "deploy production" }, true)).toBe(true);
		expect(verifierAllows(undefined)).toBe(false);
		expect(
			verifierAllows({
				action: "verify",
				target: "verifier",
				confidence: "high",
				reason: "ok",
				evidence: ["diff"],
			}),
		).toBe(true);
	});
});

describe("layer route telemetry", () => {
	it("records source on escalate", () => {
		const trace = layerRouteTrace(
			"workhorse",
			"planning",
			"escalate",
			{
				source: "api",
				id: "gpt-6.1-sol",
				provider: "openai",
				thinking: "deep",
			},
			"two failed fixes",
		);
		expect(trace.source).toBe("api");
		expect(formatLayerRoute(trace)).toMatch(/escalate workhorse → planning source api/);
	});
});

describe("D26 remaining packs", () => {
	it("scripts format uses no chat model", () => {
		const pack = loadLayeringCase("scripts", "scripts", "script-format");
		const text = layerDecisionTextFromEnvelope("scripts", pack.response);
		expect(parseLayerDecision(text)).toMatchObject({ action: "continue", target: "script" });
		expect(pack.prompt).toMatch(/format/);
	});

	it("tooling-search delegates grep off Workhorse", () => {
		const pack = loadLayeringCase("openai", "tooling", "tooling-search");
		const text = layerDecisionTextFromEnvelope("openai", pack.response);
		expect(parseLayerDecision(text)).toMatchObject(pack.expect);
		expect(parseLayerDecision(text).target).toBe("tooling");
	});

	it("workhorse-edit stays on Workhorse with brief thinking", () => {
		const pack = loadLayeringCase("openai", "workhorse", "workhorse-edit");
		expect(parseLayerDecision(layerDecisionTextFromEnvelope("openai", pack.response))).toMatchObject(pack.expect);
	});

	it("frontier-consult exits after diagnosis", () => {
		const pack = loadLayeringCase("openai", "frontier", "frontier-consult");
		expect(parseLayerDecision(layerDecisionTextFromEnvelope("openai", pack.response))).toMatchObject({
			action: "stop",
			target: "frontier",
		});
	});

	it("verifier-verdict uses a high verify action", () => {
		const pack = loadLayeringCase("anthropic", "verifier", "verifier-verdict");
		const decision = parseLayerDecision(layerDecisionTextFromEnvelope("anthropic", pack.response));
		expect(decision).toMatchObject(pack.expect);
		expect(verifierAllows(decision)).toBe(true);
	});

	it("ask-human does not continue the silent loop", () => {
		const pack = loadLayeringCase("openai", "workhorse", "ask-human");
		expect(parseLayerDecision(layerDecisionTextFromEnvelope("openai", pack.response)).action).toBe("ask_human");
	});

	it("think-deep restores the 0.17 thinking card title", () => {
		const pack = loadLayeringCase("openai", "planning", "think-deep");
		const decision = parseLayerDecision(layerDecisionTextFromEnvelope("openai", pack.response));
		expect(decision.thinking).toBe("deep");
		expect(thinkingCardTitle(decision.thinking)).toBe("thinking");
	});

	it("single-vs-layered keeps layer_workflow none on single", () => {
		const pack = loadLayeringCase("openai", "workhorse", "single-vs-layered");
		expect(pack.expect.layer_workflow).toBe("none");
		expect(pack.expect.layering).toBe("single");
	});

	it("qwen-toggle does not change the bound id", () => {
		const pack = loadLayeringCase("qwen", "workhorse", "qwen-toggle");
		const decision = parseLayerDecision(layerDecisionTextFromEnvelope("qwen", pack.response));
		expect(decision.thinking).toBe("deep");
		expect(pack.expect.boundId).toBe("qwen3-27b");
	});

	it("openai-effort keeps Terra on the same id", () => {
		const pack = loadLayeringCase("openai", "workhorse", "openai-effort");
		expect(pack.expect.boundId).toBe("gpt-6.1-terra");
		expect(parseLayerDecision(layerDecisionTextFromEnvelope("openai", pack.response)).thinking).toBe("brief");
	});

	it("kimi-swarm-xor skips CPA runners", async () => {
		const pack = loadLayeringCase("kimi", "workhorse", "kimi-swarm-xor");
		expect(pack.expect.kimiSwarm).toBe(true);
		const workflow = parseArchonWorkflow(readFileSync(join(meta, "layer-tool-runners.yaml"), "utf8"));
		const executed = await runLayerWorkflow({
			workflow,
			layering: "auto",
			seed: 42,
			kimiSwarm: true,
			runNode: async (node) => ({ id: node.id, output: "{}", status: "ok" }),
		});
		expect(executed.schedulerUsed).toBe(false);
	});

	it("mix-vendor tooling envelope stays on xAI Fast", () => {
		const pack = loadLayeringCase("xai", "tooling", "mix-vendor");
		expect(parseLayerDecision(layerDecisionTextFromEnvelope("xai", pack.response)).target).toBe("tooling");
		expect(pack.expect.writerProvider).not.toBe(pack.expect.verifierProvider);
	});

	it.skip("liquid-d1 is not a Workhorse (Decision only)", () => {
		// d1 emits zero output tokens. Workhorse packs are chat dialects.
	});
});

describe("layering benchmark", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes trek-layering-benchmark.json from fixture traces and skips live in CI", () => {
		const report = benchmarkLayering(undefined, true);
		expect(report.liveSkipped).toBe(true);
		expect(report.single.tasks).toBeGreaterThan(0);
		expect(report.layered.solved).toBeGreaterThan(0);
		expect(report.routeMix.workhorse).toBeGreaterThan(0);
		const root = mkdtempSync(join(tmpdir(), "trek-layering-bench-"));
		dirs.push(root);
		const path = join(root, "trek-layering-benchmark.json");
		writeLayeringBenchmarkJson(path, report);
		const written = JSON.parse(readFileSync(path, "utf8")) as typeof report;
		expect(written.costPerSolved.layered).toBeTypeOf("number");
	});
});
