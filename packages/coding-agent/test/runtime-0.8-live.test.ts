/**
 * Optional speed and IQ probes for the 0.8.0 hierarchy.
 * CI and ./test.sh skip these: API keys are unset and PI_NO_LOCAL_LLM=1.
 *
 * IQ is 3 fixed items (arithmetic, tool name, syllogism), not a general benchmark.
 * Speed is output tokens per second over those items.
 *
 * Grok Frontier:
 *   XAI_API_KEY=... npx vitest --run test/runtime-0.8-live.test.ts --reporter=verbose
 *   TREK_GROK_MODEL overrides grok-4.20-0309-reasoning.
 *
 * Local llama.cpp, one server per suite role whose GGUF is present
 * (tooling, workhorse, planning):
 *   ./scripts/bootstrap-llama.sh
 *   ./scripts/test-llama-live.sh
 * Weights are `<id>.gguf` under TREK_MODELS_DIR (default ~/.trek/models).
 * Files over TREK_LLAMA_MAX_BYTES (default 4 GiB) are not loaded. Those roles
 * are scored with the Frontier API instead. Mistral tooling is Qwen3.5-0.8B.
 */

import { existsSync, statSync } from "node:fs";
import { completeSimple, getModel } from "@trek/ai";
import { describe, expect, it } from "vitest";
import {
	createDefaultLlamaProcessManager,
	defaultRuntimeConfig,
	formatPerformance,
	HIERARCHY_PROBES,
	type PerformanceReport,
	type ProbeScore,
	resolveRuntime,
	resolveWeightPath,
	scoreProbeText,
	selectSessionRole,
	summarizePerformance,
	tokensPerSecond,
	weightFileExists,
	withHierarchy,
} from "../src/core/runtime/index.ts";
import type { SessionLocalRole, SuiteId } from "../src/core/runtime/types.ts";

const SUITES: SuiteId[] = ["mistral", "mistral-pro", "qwen", "lfm"];
const LOCAL_ROLES: SessionLocalRole[] = ["tooling", "workhorse", "planning"];
let nextLlamaPort = Number(process.env.TREK_LLAMA_PORT_START ?? 18180);

const grokLive = Boolean(process.env.XAI_API_KEY?.trim());
const llamaLive =
	process.env.PI_NO_LOCAL_LLM !== "1" &&
	process.env.TREK_LLAMA_LIVE === "1" &&
	Boolean(process.env.TREK_LLAMA_SERVER) &&
	existsSync(process.env.TREK_LLAMA_SERVER ?? "") &&
	Boolean(process.env.TREK_MODELS_DIR);

/** 4 GiB. Sized for a 24 GB MacBook Air with the OS and editor already resident. */
const LAPTOP_MAX_BYTES = Number(process.env.TREK_LLAMA_MAX_BYTES ?? 4 * 1024 * 1024 * 1024);

/** Q4_K_M files that do not fit the default laptop budget. */
const API_STAND_IN = new Set(["Ministral-3-8B-Reasoning-2512", "Devstral-Small-2507", "Qwen3.5-9B", "LFM2.5-8B-A1B"]);

function weightBytes(modelId: string): number {
	if (!weightFileExists(modelId)) {
		return 0;
	}
	return statSync(resolveWeightPath(modelId)).size;
}

function fitsLocally(modelId: string): boolean {
	const bytes = weightBytes(modelId);
	return bytes > 0 && bytes <= LAPTOP_MAX_BYTES;
}

function usesApiStandIn(modelId: string): boolean {
	if (!grokLive || fitsLocally(modelId)) {
		return false;
	}
	return API_STAND_IN.has(modelId) || weightBytes(modelId) > LAPTOP_MAX_BYTES;
}

function assistantText(content: { type: string; text?: string }[]): string {
	return content
		.filter((part) => part.type === "text" && part.text)
		.map((part) => part.text)
		.join(" ");
}

async function stopServer(pid: number): Promise<void> {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// already exited
	}
}

async function waitForServer(endpoint: string): Promise<void> {
	const deadline = Date.now() + 90_000;
	let lastError = "no response";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${endpoint}/models`);
			if (response.ok || response.status === 404) {
				return;
			}
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`llama-server did not answer at ${endpoint}: ${lastError}`);
}

async function completeLocal(endpoint: string, prompt: string): Promise<{ text: string; outputTokens: number }> {
	const response = await fetch(`${endpoint}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [{ role: "user", content: prompt }],
			max_tokens: 64,
			temperature: 0,
		}),
	});
	if (!response.ok) {
		throw new Error(`llama-server chat failed: HTTP ${response.status} ${await response.text()}`);
	}
	const body = (await response.json()) as {
		choices?: { message?: { content?: string; reasoning_content?: string } }[];
		usage?: { completion_tokens?: number };
	};
	const message = body.choices?.[0]?.message;
	const text = [message?.content, message?.reasoning_content].filter(Boolean).join("\n");
	return { text, outputTokens: body.usage?.completion_tokens ?? 0 };
}

async function timeProbe(
	prompt: string,
	run: (prompt: string) => Promise<{ text: string; outputTokens: number }>,
	id: string,
): Promise<ProbeScore> {
	const started = Date.now();
	const result = await run(prompt);
	const elapsedMs = Date.now() - started;
	const probe = HIERARCHY_PROBES.find((item) => item.id === id);
	if (!probe) {
		throw new Error(`missing probe ${id}`);
	}
	return {
		id,
		correct: scoreProbeText(result.text, probe),
		elapsedMs,
		outputTokens: result.outputTokens,
		tokensPerSecond: tokensPerSecond(result.outputTokens, elapsedMs),
	};
}

async function measure(
	label: string,
	modelId: string,
	run: (prompt: string) => Promise<{ text: string; outputTokens: number }>,
): Promise<PerformanceReport> {
	const scores: ProbeScore[] = [];
	for (const probe of HIERARCHY_PROBES) {
		scores.push(await timeProbe(probe.prompt, run, probe.id));
	}
	const report = summarizePerformance(label, modelId, scores);
	console.log(formatPerformance(report));
	return report;
}

async function scoreWithGrok(label: string): Promise<PerformanceReport> {
	const modelId = process.env.TREK_GROK_MODEL?.trim() || "grok-4.20-0309-reasoning";
	return measure(label, modelId, async (prompt) => {
		const message = await completeSimple(
			getModel("xai", modelId),
			{ messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
			{ maxTokens: 128, reasoning: "low" },
		);
		expect(message.stopReason).not.toBe("error");
		expect(message.errorMessage).toBeUndefined();
		return { text: assistantText(message.content), outputTokens: message.usage.output };
	});
}

describe.skipIf(!grokLive)("optional Grok Frontier speed and IQ", () => {
	it("hybrid Frontier is xAI and Grok is scored", async () => {
		const resolved = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
			env: { XAI_API_KEY: process.env.XAI_API_KEY ?? "", OPENAI_API_KEY: "" },
		});
		expect(resolved.effectiveMode).toBe("hybrid");
		const selection = selectSessionRole({ text: "/frontier say ok", resolved });
		expect(selection).toMatchObject({ role: "frontier", source: "api", provider: "xai" });

		const report = await scoreWithGrok("frontier grok");
		expect(report.total).toBe(HIERARCHY_PROBES.length);
		expect(report.elapsedMs).toBeGreaterThan(0);
		expect(report.correct).toBeGreaterThanOrEqual(2);
	}, 180_000);
});

describe("optional local or API stand-in speed and IQ", () => {
	for (const suite of SUITES) {
		const resolved = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite }), {
			frontier: null,
		});
		for (const role of LOCAL_ROLES) {
			const modelId = resolved.roles[role]?.id ?? "";
			const local = llamaLive && fitsLocally(modelId);
			const standIn = usesApiStandIn(modelId);
			it.skipIf(!local && !standIn)(
				`${suite} ${role} speed and IQ`,
				async () => {
					if (standIn && !local) {
						const report = await scoreWithGrok(`api stand-in ${suite} ${role} (${modelId})`);
						expect(report.total).toBe(HIERARCHY_PROBES.length);
						expect(report.correct).toBeGreaterThanOrEqual(2);
						return;
					}
					process.env.TREK_LLAMA_PORT_START = String(nextLlamaPort);
					nextLlamaPort += 1;
					const manager = createDefaultLlamaProcessManager();
					const handle = manager.ensure(role, resolved);
					try {
						await waitForServer(handle.endpoint);
						const report = await measure(`${suite} ${role}`, modelId, (prompt) =>
							completeLocal(handle.endpoint, prompt),
						);
						expect(report.total).toBe(HIERARCHY_PROBES.length);
						expect(report.elapsedMs).toBeGreaterThan(0);
						expect(manager.list()).toHaveLength(1);
					} finally {
						await stopServer(handle.pid);
					}
				},
				local ? 300_000 : 180_000,
			);
		}
	}
});
