/**
 * Optional. Loads each local chat GGUF that is already on disk and checks
 * that llama.cpp returns a write tool call in that family's dialect.
 * ./test.sh sets PI_NO_LOCAL_LLM=1, so CI skips this file.
 *
 *   set -a && source ~/.trek/llama-live.env && set +a
 *   unset PI_NO_LOCAL_LLM
 *   node ../../node_modules/vitest/dist/cli.js --run test/tool-dialect-live.test.ts --reporter=verbose
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { llamaServerArgs, weightFileExists } from "../src/core/runtime/process-manager.ts";
import { toolDialect } from "../src/core/runtime/tool-dialect.ts";
import { WEIGHT_SOURCES } from "../src/core/runtime/weight-download.ts";

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

const models = Object.keys(WEIGHT_SOURCES);

describe.skipIf(!live)("tool dialects on real weights", () => {
	let port = 18320;

	for (const modelId of models) {
		it(`${modelId} returns a write call in its dialect`, async () => {
			const dialect = toolDialect(modelId);
			expect(dialect, modelId).toBeDefined();
			if (!weightFileExists(modelId)) {
				console.log(`skip ${modelId} (${dialect}): weight not on disk`);
				return;
			}
			const serverPort = port++;
			const binary = process.env.TREK_LLAMA_SERVER ?? "";
			const args = [
				...llamaServerArgs({
					role: "workhorse",
					modelId,
					port: serverPort,
					quant: "q4_k_m",
					endpoint: `http://127.0.0.1:${serverPort}/v1`,
				}),
				"--reasoning",
				"off",
			];
			const child = spawn(binary, args, { stdio: "ignore" });
			if (!child.pid) throw new Error(`did not spawn ${modelId}`);
			try {
				await waitForHealth(serverPort);
				const response = await fetch(`http://127.0.0.1:${serverPort}/v1/chat/completions`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						temperature: 0,
						max_tokens: 512,
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
				expect(response.status, JSON.stringify(body.error ?? body).slice(0, 400)).toBe(200);
				const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
				const argumentsText = call?.arguments ?? "";
				console.log(
					`${modelId} dialect ${dialect} prompt ${body.usage?.prompt_tokens ?? 0} completion ${body.usage?.completion_tokens ?? 0} finish ${body.choices?.[0]?.finish_reason} call ${call?.name ?? "none"}`,
				);
				expect(call?.name, argumentsText.slice(0, 180)).toBe("write");
				expect(argumentsText).toContain("index.html");
			} finally {
				await stop(child.pid);
			}
		}, 180_000);
	}
});
