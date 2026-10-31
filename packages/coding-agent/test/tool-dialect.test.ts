import { describe, expect, it } from "vitest";
import { llamaServerArgs } from "../src/core/runtime/process-manager.ts";
import { suiteChatDialects, TOOL_DIALECTS, toolDialect } from "../src/core/runtime/tool-dialect.ts";

const EXPECTED: Record<string, string> = {
	"mistral:workhorse": "mistral",
	"mistral:planning": "mistral",
	"mistral-pro:workhorse": "mistral",
	"mistral-pro:planning": "mistral",
	"qwen:workhorse": "qwen",
	"qwen:planning": "qwen",
	"lfm:workhorse": "lfm",
	"lfm:planning": "lfm",
};

describe("suite tool dialects", () => {
	it("assigns each chat role its family dialect", () => {
		const rows = suiteChatDialects();
		expect(rows).toHaveLength(8);
		for (const row of rows) {
			expect(row.dialect, `${row.suite} ${row.role} ${row.id}`).toBe(EXPECTED[`${row.suite}:${row.role}`]);
			expect(TOOL_DIALECTS[row.dialect].length).toBeGreaterThan(0);
		}
	});

	it("does not treat embeddings as a chat dialect", () => {
		expect(toolDialect("LFM2-ColBERT-350M")).toBeUndefined();
		expect(toolDialect("Qwen3-Embedding-0.6B")).toBeUndefined();
		expect(toolDialect("sentence-transformers/all-MiniLM-L6-v2")).toBeUndefined();
	});

	it("loads Liquid's template only for LFM2.5", () => {
		const lfm = llamaServerArgs({
			role: "workhorse",
			modelId: "LFM2.5-1.2B-Instruct",
			port: 9,
			quant: "q4_k_m",
			endpoint: "http://127.0.0.1:9/v1",
		});
		expect(lfm.indexOf("--jinja")).toBeLessThan(lfm.indexOf("--chat-template-file"));
		expect(lfm.some((arg) => arg.endsWith("lfm2.5-chat-template.jinja"))).toBe(true);

		for (const modelId of [
			"Qwen3.5-0.8B",
			"Qwen3.5-4B",
			"Qwen3.5-9B",
			"Ministral-3-3B-Instruct-2512",
			"Ministral-3-8B-Reasoning-2512",
			"Devstral-Small-2507",
		]) {
			const args = llamaServerArgs({
				role: "workhorse",
				modelId,
				port: 9,
				quant: "q4_k_m",
				endpoint: "http://127.0.0.1:9/v1",
			});
			expect(args, modelId).toContain("--jinja");
			expect(args, modelId).not.toContain("--chat-template-file");
		}
	});
});
