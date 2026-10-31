import { describe, expect, it } from "vitest";
import { LFM_CHAT_TEMPLATE, usesLfmToolDialect } from "../src/core/runtime/lfm-chat-template.ts";
import { llamaServerArgs } from "../src/core/runtime/process-manager.ts";

describe("LFM tool dialect", () => {
	it("loads Liquid's tool-call template only for LFM", () => {
		expect(usesLfmToolDialect("LFM2.5-1.2B-Instruct")).toBe(true);
		expect(usesLfmToolDialect("Qwen3.5-0.8B")).toBe(false);
		expect(LFM_CHAT_TEMPLATE).toContain("<|tool_call_start|>");
		expect(LFM_CHAT_TEMPLATE).toContain("<|tool_response_start|>");
		expect(LFM_CHAT_TEMPLATE).not.toContain("raise_exception");
		const lfm = llamaServerArgs({
			role: "workhorse",
			modelId: "LFM2.5-1.2B-Instruct",
			port: 9,
			quant: "q4_k_m",
			endpoint: "http://127.0.0.1:9/v1",
		});
		expect(lfm.indexOf("--jinja")).toBeLessThan(lfm.indexOf("--chat-template-file"));
		const qwen = llamaServerArgs({
			role: "workhorse",
			modelId: "Qwen3.5-4B",
			port: 9,
			quant: "q4_k_m",
			endpoint: "http://127.0.0.1:9/v1",
		});
		expect(qwen).not.toContain("--chat-template-file");
	});
});
