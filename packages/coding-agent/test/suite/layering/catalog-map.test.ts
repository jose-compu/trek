/**
 * /hierarchy auto catalog map. Fixtures only; no live list-models.
 * Run: npx vitest run test/suite/layering/catalog-map.test.ts --reporter=verbose
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyAutoLayering, loadCatalogFixture, mapCatalogToRoles } from "../../../src/core/runtime/catalog-map.ts";
import { defaultRuntimeConfig, flattenToSingle, withHierarchy } from "../../../src/core/runtime/index.ts";
import { resolveRuntime } from "../../../src/core/runtime/resolve.ts";
import { selectSessionRole } from "../../../src/core/runtime/select-role.ts";

const catalogs = join(dirname(fileURLToPath(import.meta.url)), "fixtures/catalogs");

function load(name: string) {
	return loadCatalogFixture(join(catalogs, `${name}.json`));
}

describe("catalog auto-map", () => {
	it("maps OpenAI Luna/Terra/Sol/Astra from tags, not SKU names in code", () => {
		const mapped = mapCatalogToRoles(load("openai"));
		expect(mapped.layering).toBe("auto");
		expect(mapped.roles.tooling).toMatchObject({ id: "gpt-6-luna", provider: "openai", thinking: "off" });
		expect(mapped.roles.workhorse).toMatchObject({ id: "gpt-6.1-terra", thinking: "brief" });
		expect(mapped.roles.planning).toMatchObject({ id: "gpt-6.1-sol", thinking: "deep" });
		expect(mapped.roles.frontier).toMatchObject({ id: "gpt-6-astra", thinking: "deep" });
	});

	it("collapses a one-model catalog to single Workhorse", () => {
		const mapped = mapCatalogToRoles(load("openai-single"));
		expect(mapped.layering).toBe("single");
		expect(mapped.roles.workhorse?.id).toBe("gpt-6.1-terra");
		expect(mapped.roles.planning).toBeUndefined();
		expect(mapped.roles.tooling).toBeUndefined();
		expect(mapped.roles.frontier).toBeUndefined();
	});

	it("maps xAI Fast/mid/coding/multi-agent from catalog tags", () => {
		const mapped = mapCatalogToRoles(load("xai"));
		expect(mapped.roles.tooling?.id).toBe("grok-4.1-fast");
		expect(mapped.roles.workhorse?.id).toBe("grok-4.3");
		expect(mapped.roles.planning?.id).toBe("grok-4.5");
		expect(mapped.roles.frontier?.id).toBe("grok-4.20-multi-agent");
	});

	it("binds Workhorse + Planning when Anthropic has no Frontier tag", () => {
		const mapped = mapCatalogToRoles(load("anthropic"));
		expect(mapped.roles.workhorse?.id).toBe("claude-sonnet-4-5");
		expect(mapped.roles.planning?.id).toBe("claude-opus-4-5");
		expect(mapped.roles.tooling?.id).toBe("claude-haiku-4-5");
		expect(mapped.roles.frontier).toBeUndefined();
	});

	it("maps GLM Flash to Workhorse and GLM-5.3 to Planning", () => {
		const mapped = mapCatalogToRoles(load("glm"));
		expect(mapped.roles.workhorse?.id).toBe("glm-5.3-flash");
		expect(mapped.roles.planning?.id).toBe("glm-5.3");
		expect(mapped.roles.frontier).toBeUndefined();
	});

	it("maps Kimi K2.7 Workhorse and K3 Planning; same-id Frontier is an alias", () => {
		const mapped = mapCatalogToRoles(load("kimi"));
		expect(mapped.roles.workhorse?.id).toBe("kimi-k2.7-code");
		expect(mapped.roles.planning?.id).toBe("kimi-k3");
		expect(mapped.roles.frontier).toBeUndefined();
	});

	it("skips Qwen Decision rows and keeps local source on Tooling/Workhorse", () => {
		const mapped = mapCatalogToRoles(load("qwen"));
		expect(mapped.roles.tooling).toMatchObject({ id: "Qwen3.5-9B", source: "local" });
		expect(mapped.roles.workhorse).toMatchObject({ id: "Qwen3.8-27B", source: "local", thinking: "brief" });
		expect(mapped.roles.planning).toBeUndefined();
		expect(mapped.roles.frontier).toBeUndefined();
	});

	it("leaves a Decision-only Liquid catalog as single with no extra roles", () => {
		const mapped = mapCatalogToRoles(load("liquid-d1"));
		expect(mapped.layering).toBe("single");
		expect(mapped.roles).toEqual({});
	});

	it("does not auto-bind verifier or Decision", () => {
		const mapped = mapCatalogToRoles(load("openai"));
		expect("verifier" in mapped.roles).toBe(false);
		expect("decision" in mapped.roles).toBe(false);
	});

	it("writes auto roles into config and resolve skips suite extras", () => {
		const config = applyAutoLayering(defaultRuntimeConfig(), load("openai"));
		expect(config.hierarchy.layering).toBe("auto");
		expect(config.roles.verifier).toBeUndefined();
		expect(config.roles.decision).toBeUndefined();
		const resolved = resolveRuntime(config, { frontier: null });
		expect(resolved.roles.workhorse?.id).toBe("gpt-6.1-terra");
		expect(resolved.roles.planning?.id).toBe("gpt-6.1-sol");
		expect(resolved.roles.frontier?.id).toBe("gpt-6-astra");
		expect(resolved.roles.tooling?.id).toBe("gpt-6-luna");
		expect(resolved.roles.verifier).toBeUndefined();
	});

	it("single then auto re-applies the map; provider switch remaps", () => {
		const layered = applyAutoLayering(defaultRuntimeConfig(), load("openai"));
		const flat = flattenToSingle(layered);
		expect(flat.hierarchy.layering).toBe("single");
		expect(flat.roles.planning).toBeUndefined();
		expect(flat.roles.workhorse?.id).toBe("gpt-6.1-terra");
		const again = applyAutoLayering(flat, load("openai"));
		expect(again.roles.planning?.id).toBe("gpt-6.1-sol");
		const switched = applyAutoLayering(withHierarchy(again, { layering: "auto" }), load("xai"));
		expect(switched.roles.workhorse?.id).toBe("grok-4.3");
		expect(switched.roles.planning?.id).toBe("grok-4.5");
		expect(switched.roles.tooling?.id).toBe("grok-4.1-fast");
	});

	it("one-model apply stays single and does not expand extras", () => {
		const config = applyAutoLayering(defaultRuntimeConfig(), load("openai-single"));
		expect(config.hierarchy.layering).toBe("single");
		expect(config.roles.workhorse?.id).toBe("gpt-6.1-terra");
		expect(resolveRuntime(config, { frontier: null }).roles.planning).toBeUndefined();
	});

	it("layered api climbs mapped SKUs instead of collapsing to Frontier", () => {
		const openai = resolveRuntime(applyAutoLayering(defaultRuntimeConfig(), load("openai")), {
			frontier: { provider: "openai", modelId: "frontier" },
		});
		expect(selectSessionRole({ text: "list the files", resolved: openai })).toMatchObject({
			role: "workhorse",
			modelId: "gpt-6.1-terra",
		});
		expect(selectSessionRole({ text: "debug the hard bug", resolved: openai })).toMatchObject({
			role: "frontier",
			modelId: "gpt-6-astra",
		});
		const anthropic = resolveRuntime(applyAutoLayering(defaultRuntimeConfig(), load("anthropic")), {
			frontier: { provider: "anthropic", modelId: "frontier" },
		});
		expect(anthropic.roles.frontier).toBeUndefined();
		expect(selectSessionRole({ text: "debug the hard bug", resolved: anthropic })).toMatchObject({
			role: "planning",
			modelId: "claude-opus-4-5",
		});
	});
});
