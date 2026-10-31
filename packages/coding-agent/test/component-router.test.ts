/**
 * 0.9.0 ComponentRouter. Role name stays Workhorse.
 * Run: npx vitest run test/component-router.test.ts --reporter=verbose
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuditStep, isValidAuditStep, resolveReproducibility } from "../src/core/reproducibility/index.ts";
import {
	defaultRuntimeConfig,
	readRuntimeConfigFile,
	resolveRuntime,
	routeComponent,
	withHierarchy,
	writeRuntimeConfigFile,
} from "../src/core/runtime/index.ts";

function localResolved() {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
		frontier: null,
	});
}

describe("component router", () => {
	const dirs: string[] = [];
	afterEach(() => {
		while (dirs.length > 0) {
			rmSync(dirs.pop()!, { recursive: true, force: true });
		}
	});

	it("names the Work-horse on a tool-selection step and stores the reason", () => {
		const resolved = localResolved();
		const route = routeComponent({
			component: "toolIntent",
			resolved,
			complexity: 0.1,
			retries: 0,
			depth: 1,
		});
		expect(route.role).toBe("workhorse");
		expect(route.modelId).toBe("Ministral-3-3B-Instruct-2512");
		expect(route.reason).toMatch(/toolIntent uses workhorse/);

		const assistant = fauxAssistantMessage("write the file");
		assistant.model = route.modelId;
		const record = buildAuditStep({
			stepNumber: 1,
			assistant,
			priorMessages: [{ role: "user", content: "select the tool" }],
			reproducibility: resolveReproducibility({ settings: { seed: 1 } }),
			toolNames: ["write"],
			skillNames: [],
			role: route.role,
			source: route.source === "api" ? "api" : "local",
			routeReason: route.reason,
			clock: () => new Date("2026-10-27T00:00:00.000Z"),
		});
		expect(isValidAuditStep(record)).toBe(true);
		expect(record.model).toBe("Ministral-3-3B-Instruct-2512");
		expect(record.role).toBe("workhorse");
		expect(record.routeReason).toBe(route.reason);
	});

	it("uses the next tier when a subtask fails on retry 2", () => {
		const resolved = localResolved();
		const first = routeComponent({ component: "mechanical", resolved, retries: 0, depth: 1 });
		const retry = routeComponent({ component: "mechanical", resolved, retries: 2, depth: 1 });
		expect(first.role).toBe("workhorse");
		expect(first.modelId).toBe("Ministral-3-3B-Instruct-2512");
		expect(retry.role).toBe("planning");
		expect(retry.modelId).toBe("Ministral-3-8B-Reasoning-2512");
		expect(retry.reason).toMatch(/next tier after workhorse/);
	});

	it("keeps a static YAML pin ahead of the dynamic policy", () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-route-"));
		dirs.push(dir);
		const path = join(dir, "models.yaml");
		const config = withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" });
		config.routing = { components: { worldModel: "workhorse" } };
		writeRuntimeConfigFile(path, config);
		const loaded = readRuntimeConfigFile(path);
		expect(loaded.routing?.components?.worldModel).toBe("workhorse");
		const route = routeComponent({
			component: "worldModel",
			resolved: resolveRuntime(loaded, { frontier: null }),
			overrides: loaded.routing?.components,
			complexity: 0.9,
		});
		expect(route.role).toBe("workhorse");
		expect(route.reason).toMatch(/static override/);
	});

	it("records the session model as frontier in api mode", () => {
		const resolved = resolveRuntime(defaultRuntimeConfig(), {
			frontier: { provider: "xai", modelId: "grok-4" },
		});
		const route = routeComponent({ component: "toolIntent", resolved });
		expect(route.role).toBe("frontier");
		expect(route.modelId).toBe("grok-4");
		expect(route.reason).toMatch(/session model as frontier/);
	});

	it("escalates a heavy hybrid step to Frontier and a cheap step to Workhorse", () => {
		const hybrid = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
			frontier: { provider: "anthropic", modelId: "frontier" },
		});
		const regular = routeComponent({ component: "intend", resolved: hybrid, depth: 0, complexity: 0.2 });
		expect(regular.role).toBe("planning");
		expect(regular.reason).toMatch(/intend uses planning/);
		const heavy = routeComponent({ component: "intend", resolved: hybrid, depth: 0, complexity: 0.85 });
		expect(heavy.role).toBe("frontier");
		expect(heavy.reason).toMatch(/complexity 0\.85 escalates/);
		const cheap = routeComponent({
			component: "toolIntent",
			resolved: hybrid,
			depth: 1,
			budgetRemaining: 0.1,
		});
		expect(cheap.role).toBe("workhorse");
		expect(cheap.reason).toMatch(/Workhorse/);
	});
});
