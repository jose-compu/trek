/**
 * Layered API network pin and Tooling auto-delegate.
 * Run: npx vitest run test/suite/layering/layer-network.test.ts --reporter=verbose
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyAutoLayering, defaultRuntimeConfig, loadCatalogFixture } from "../../../src/core/runtime/index.ts";
import {
	layeringNetworkSection,
	needsLiveNetwork,
	shouldAutoDelegateLiveNetwork,
	shouldInjectLayerNetwork,
} from "../../../src/core/runtime/layer-network.ts";
import { resolveRuntime } from "../../../src/core/runtime/resolve.ts";

const catalogs = join(dirname(fileURLToPath(import.meta.url)), "fixtures/catalogs");

describe("layer network", () => {
	it("treats weather and URLs as live network work", () => {
		expect(needsLiveNetwork("what is the weather in paris?")).toBe(true);
		expect(needsLiveNetwork("fetch https://example.com")).toBe(true);
		expect(needsLiveNetwork("do you have internet access?")).toBe(true);
		expect(needsLiveNetwork("grep the log")).toBe(false);
		expect(needsLiveNetwork("fix the typo in README.md")).toBe(false);
	});

	it("pins bash internet and Tooling delegate when tooling is bound", () => {
		const pinned = layeringNetworkSection(true);
		expect(pinned).toMatch(/This computer has internet/);
		expect(pinned).toMatch(/curl or wget/);
		expect(pinned).toMatch(/Do not say you have no internet/);
		expect(pinned).toContain('{"action":"delegate","target":"tooling","reason":"live fetch"}');
		expect(pinned).toMatch(/Do not say you cannot change models/);
		expect(layeringNetworkSection(false)).not.toMatch(/delegate/);
		expect(layeringNetworkSection(false)).toMatch(/Workhorse ⇄ Planning ⇄ Frontier/);
	});

	it("auto-delegates weather on xAI auto layering, not on single", () => {
		const catalog = loadCatalogFixture(join(catalogs, "xai.json"));
		const layered = resolveRuntime(applyAutoLayering(defaultRuntimeConfig(), catalog));
		expect(layered.layering).toBe("auto");
		expect(layered.roles.tooling?.id).toBe("grok-4.1-fast");
		expect(shouldInjectLayerNetwork(layered)).toBe(true);
		expect(shouldAutoDelegateLiveNetwork("what is the weather in paris?", layered)).toBe(true);
		expect(shouldAutoDelegateLiveNetwork("fix the typo", layered)).toBe(false);
		const single = resolveRuntime(defaultRuntimeConfig());
		expect(single.layering).toBe("single");
		expect(shouldAutoDelegateLiveNetwork("what is the weather in paris?", single)).toBe(false);
	});
});
