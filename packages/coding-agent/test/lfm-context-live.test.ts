/**
 * Optional. Loads the LFM GGUFs already on disk and checks that a tool turn fits.
 * ./test.sh sets PI_NO_LOCAL_LLM=1, so CI skips this file.
 *
 *   set -a && source ~/.trek/llama-live.env && set +a
 *   unset PI_NO_LOCAL_LLM TREK_NO_LOCAL_LLM
 *   node ../../node_modules/vitest/dist/cli.js --run test/lfm-context-live.test.ts --reporter=verbose
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contextBudget, localContextWindow, smallContextPrompt } from "../src/core/runtime/context-budget.ts";
import { llamaServerArgs, weightFileExists } from "../src/core/runtime/process-manager.ts";

const MODELS = ["LFM2.5-350M", "LFM2.5-1.2B-Instruct", "LFM2.5-8B-A1B"] as const;

const live =
	process.env.PI_NO_LOCAL_LLM !== "1" &&
	Boolean(process.env.TREK_LLAMA_SERVER) &&
	existsSync(process.env.TREK_LLAMA_SERVER ?? "") &&
	Boolean(process.env.TREK_MODELS_DIR);

const writeTool = {
	type: "function",
	function: {
		name: "write",
		description: "Write a file. path is a file, not a folder.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				content: { type: "string" },
			},
			required: ["path", "content"],
		},
	},
};

async function stop(pid: number): Promise<void> {
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
		// already gone
	}
}

async function waitForHealth(port: number): Promise<void> {
	const deadline = Date.now() + 120_000;
	let last = "no response";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/health`);
			if (response.ok) return;
			last = `HTTP ${response.status}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error(`llama-server on ${port} did not start: ${last}`);
}

describe.skipIf(!live)("LFM context on real weights", () => {
	let port = 18220;

	for (const modelId of MODELS) {
		it(`${modelId} accepts a tool turn inside its window`, async () => {
			if (!weightFileExists(modelId)) {
				console.log(`skip ${modelId}: weight not on disk`);
				return;
			}
			const window = localContextWindow(modelId);
			const budget = contextBudget(window);
			const serverPort = port++;
			const binary = process.env.TREK_LLAMA_SERVER ?? "";
			const args = llamaServerArgs({
				role: "workhorse",
				modelId,
				port: serverPort,
				quant: "q4_k_m",
				endpoint: `http://127.0.0.1:${serverPort}/v1`,
			});
			const child = spawn(binary, [...args, "--reasoning", "off"], { stdio: "ignore" });
			if (!child.pid) throw new Error(`did not spawn ${modelId}`);
			try {
				await waitForHealth(serverPort);
				const response = await fetch(`http://127.0.0.1:${serverPort}/v1/chat/completions`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						temperature: 0,
						max_tokens: 1024,
						tool_choice: "required",
						messages: [{ role: "user", content: "Create index.html in this folder with a title Chess." }],
						tools: [writeTool],
					}),
				});
				const body = (await response.json()) as {
					error?: { message?: string };
					usage?: { prompt_tokens?: number; completion_tokens?: number };
					choices?: {
						finish_reason?: string;
						message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
					}[];
				};
				expect(response.status, JSON.stringify(body.error ?? body)).toBe(200);
				const promptTokens = body.usage?.prompt_tokens ?? 0;
				const message = body.choices?.[0]?.message;
				console.log(
					`${modelId} window ${window} prompt ${promptTokens} completion ${body.usage?.completion_tokens ?? 0} finish ${body.choices?.[0]?.finish_reason} call ${message?.tool_calls?.[0]?.function?.name ?? "none"}`,
				);
				if (!message?.tool_calls?.length) {
					console.log(JSON.stringify(message ?? body).slice(0, 500));
				}
				expect(promptTokens).toBeGreaterThan(0);
				expect(promptTokens + budget.outputTokens).toBeLessThanOrEqual(window);
				expect(Math.ceil(smallContextPrompt("/tmp/chess").length / 4) + promptTokens).toBeLessThan(window);
				expect(body.choices?.[0]?.finish_reason).toBe("tool_calls");
				const call = message?.tool_calls?.[0]?.function;
				expect(call?.name).toBe("write");
				const argumentsText = call?.arguments ?? "";
				expect(argumentsText).toContain("index.html");
				expect(argumentsText).not.toContain("all-trek-agent");
			} finally {
				await stop(child.pid);
			}
		}, 180_000);
	}
});
