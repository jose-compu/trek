import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "../src/core/compaction/compaction.ts";
import {
	contextBudget,
	fitCompactionSettings,
	localContextWindow,
	smallContextPrompt,
} from "../src/core/runtime/context-budget.ts";
import { localLlamaChatModel } from "../src/core/runtime/local-model.ts";

describe("context budget", () => {
	it("keeps reserve and recent tokens inside a 2048 window", () => {
		const budget = contextBudget(2048);
		expect(budget.small).toBe(true);
		expect(budget.outputTokens).toBeLessThan(2048);
		expect(budget.reserveTokens).toBeLessThan(2048);
		expect(budget.keepRecentTokens).toBeLessThan(2048);
		const fitted = fitCompactionSettings(DEFAULT_COMPACTION_SETTINGS, 2048);
		expect(fitted.reserveTokens).toBe(budget.reserveTokens);
		expect(fitted.keepRecentTokens).toBe(budget.keepRecentTokens);
		expect(shouldCompact(2000, 2048, fitted)).toBe(true);
		expect(shouldCompact(100, 2048, fitted)).toBe(false);
	});

	it("leaves a large window on the default compaction settings", () => {
		const fitted = fitCompactionSettings(DEFAULT_COMPACTION_SETTINGS, 128_000);
		expect(contextBudget(128_000).small).toBe(false);
		expect(fitted).toEqual(DEFAULT_COMPACTION_SETTINGS);
	});

	it("gives the LFM suite an 8192 floor when the env asks for 2048", () => {
		const previous = process.env.TREK_LLAMA_CTX;
		process.env.TREK_LLAMA_CTX = "2048";
		try {
			const model = localLlamaChatModel({ modelId: "LFM2.5-1.2B-Instruct", endpoint: "http://127.0.0.1:9/v1" });
			expect(model.contextWindow).toBe(8192);
			expect(localContextWindow("LFM2.5-350M", process.env)).toBe(8192);
			expect(localContextWindow("LFM2.5-8B-A1B", { TREK_LLAMA_CTX: "16384" })).toBe(16384);
			const budget = contextBudget(8192);
			expect(budget.small).toBe(false);
			expect(budget.reserveTokens).toBeLessThan(8192);
			expect(budget.keepRecentTokens).toBeLessThan(8192);
			expect(model.maxTokens).toBeLessThan(model.contextWindow);
			const fitted = fitCompactionSettings(DEFAULT_COMPACTION_SETTINGS, 8192);
			expect(shouldCompact(7000, 8192, fitted)).toBe(true);
			expect(shouldCompact(500, 8192, fitted)).toBe(false);
		} finally {
			if (previous === undefined) {
				delete process.env.TREK_LLAMA_CTX;
			} else {
				process.env.TREK_LLAMA_CTX = previous;
			}
		}
	});

	it("keeps a non-LFM 2048 window small", () => {
		const previous = process.env.TREK_LLAMA_CTX;
		process.env.TREK_LLAMA_CTX = "2048";
		try {
			const model = localLlamaChatModel({ modelId: "Qwen3.5-0.8B", endpoint: "http://127.0.0.1:9/v1" });
			expect(model.contextWindow).toBe(2048);
			expect(model.maxTokens).toBe(contextBudget(2048).outputTokens);
		} finally {
			if (previous === undefined) {
				delete process.env.TREK_LLAMA_CTX;
			} else {
				process.env.TREK_LLAMA_CTX = previous;
			}
		}
	});

	it("keeps the small prompt short", () => {
		const prompt = smallContextPrompt("/tmp/game");
		expect(prompt).toContain("/tmp/game");
		expect(prompt.length).toBeLessThan(500);
	});
});
