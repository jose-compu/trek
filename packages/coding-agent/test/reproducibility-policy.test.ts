/**
 * 0.7.0 Audit — reproducibility policy (#70, #75).
 * Run: npx vitest run test/reproducibility-policy.test.ts --reporter=verbose
 */

import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertStrictAuditProvider,
	DEFAULT_SESSION_SEED,
	getCpaPrngSeed,
	getProviderDeterminism,
	isStrictAuditProvider,
	parseSessionRecord,
	resolveReproducibility,
	toSessionRecord,
} from "../src/core/reproducibility/index.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("reproducibility policy (#70)", () => {
	it("defaults to seed 42, mode default, temp 0, top_p 1", () => {
		const resolved = resolveReproducibility();
		expect(resolved).toEqual({
			mode: "default",
			seed: DEFAULT_SESSION_SEED,
			seedSource: "default",
			temperature: 0,
			topP: 1,
			cpaSeed: DEFAULT_SESSION_SEED,
		});
	});

	it("uses settings seed and mode", () => {
		const resolved = resolveReproducibility({
			settings: { mode: "strict_audit", seed: 7, temperature: 0.2, topP: 0.9 },
		});
		expect(resolved.mode).toBe("strict_audit");
		expect(resolved.seed).toBe(7);
		expect(resolved.seedSource).toBe("settings");
		expect(resolved.temperature).toBe(0.2);
		expect(resolved.topP).toBe(0.9);
		expect(resolved.cpaSeed).toBe(7);
	});

	it("env seed and mode win over settings (D5)", () => {
		const resolved = resolveReproducibility({
			settings: { mode: "default", seed: 1 },
			env: { mode: "strict_audit", seed: "99" },
		});
		expect(resolved.mode).toBe("strict_audit");
		expect(resolved.seed).toBe(99);
		expect(resolved.seedSource).toBe("env");
	});

	it("TREK_SEED=random generates once via the provided RNG", () => {
		const resolved = resolveReproducibility({
			env: { seed: "random" },
			random: () => 123456,
		});
		expect(resolved.seed).toBe(123456);
		expect(resolved.seedSource).toBe("random");
		expect(resolved.cpaSeed).toBe(123456);
	});

	it("settings seed random uses RNG", () => {
		const resolved = resolveReproducibility({
			settings: { seed: "random" },
			random: () => 8,
		});
		expect(resolved.seed).toBe(8);
		expect(resolved.seedSource).toBe("random");
	});

	it("round-trips the session record", () => {
		const resolved = resolveReproducibility({ settings: { seed: 42 } });
		const record = toSessionRecord(resolved);
		expect(parseSessionRecord(record)).toEqual(record);
		expect(parseSessionRecord({ ...record, schemaVersion: 99 })).toBeUndefined();
	});

	it("CPA seed matches the session seed (#75)", () => {
		const resolved = resolveReproducibility({ settings: { seed: 11 } });
		expect(getCpaPrngSeed(resolved)).toBe(11);
	});
});

describe("strict_audit provider gate (#70)", () => {
	it("allows faux and refuses anthropic / openai", () => {
		expect(isStrictAuditProvider("faux")).toBe(true);
		expect(isStrictAuditProvider("anthropic")).toBe(false);
		expect(getProviderDeterminism("openai").support).toBe("best-effort");
		expect(() => assertStrictAuditProvider("anthropic")).toThrow(/strict_audit refuses/);
	});
});

describe("settings reproducibility (#70)", () => {
	it("persists and reads reproducibility settings", async () => {
		const manager = SettingsManager.inMemory();
		expect(manager.getReproducibilitySettings()).toEqual({});
		manager.setReproducibilitySettings({ mode: "strict_audit", seed: 3 });
		await manager.flush();
		expect(manager.getReproducibilitySettings()).toEqual({ mode: "strict_audit", seed: 3 });
	});
});

describe("session JSONL trek:reproducibility (#70)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		delete process.env.TREK_SEED;
		delete process.env.TREK_REPRODUCIBILITY_MODE;
	});

	it("writes the session seed once on first prompt", async () => {
		const harness = await createHarness({
			settings: { reproducibility: { seed: 42 } },
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hello");

		const record = parseSessionRecord(harness.sessionManager.getReproducibilityTrace());
		expect(record).toMatchObject({
			schemaVersion: 1,
			mode: "default",
			seed: 42,
			seedSource: "settings",
			cpaSeed: 42,
		});
		expect(harness.session.getReproducibility().seed).toBe(42);
		expect(harness.session.agent.seed).toBe(42);
		expect(harness.session.agent.temperature).toBe(0);
		expect(harness.session.agent.topP).toBe(1);

		harness.setResponses([fauxAssistantMessage("again")]);
		await harness.session.prompt("second");
		const entries = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "trek:reproducibility");
		expect(entries).toHaveLength(1);
	});

	it("refuses anthropic in strict_audit", async () => {
		const harness = await createHarness({
			settings: { reproducibility: { mode: "strict_audit", seed: 42 } },
		});
		harnesses.push(harness);
		const model = harness.getModel();
		harness.session.agent.state.model = { ...model, provider: "anthropic", id: "claude-sonnet-4-6" };
		harness.setResponses([fauxAssistantMessage("nope")]);
		await expect(harness.session.prompt("hi")).rejects.toThrow(/strict_audit refuses/);
	});
});
