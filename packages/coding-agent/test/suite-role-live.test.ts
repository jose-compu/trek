/**
 * Optional. For each local suite, the Act role the router picks is loaded and
 * must return a write of index.html. Planning is the think hop, not this server.
 * ./test.sh sets PI_NO_LOCAL_LLM=1, so CI skips this file.
 *
 *   set -a && source ~/.trek/llama-live.env && set +a
 *   unset PI_NO_LOCAL_LLM
 *   node ../../node_modules/vitest/dist/cli.js --run test/suite-role-live.test.ts --reporter=verbose
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	defaultRuntimeConfig,
	localLlamaChatModel,
	localServerCommand,
	resolveRuntime,
	selectSessionRole,
	useMlx,
	waitForLocalServer,
	weightFileExists,
	withHierarchy,
} from "../src/core/runtime/index.ts";
import type { SuiteId } from "../src/core/runtime/types.ts";

const live =
	process.env.PI_NO_LOCAL_LLM !== "1" &&
	Boolean(process.env.TREK_LLAMA_SERVER) &&
	existsSync(process.env.TREK_LLAMA_SERVER ?? "") &&
	Boolean(process.env.TREK_MODELS_DIR);

const SUITES: SuiteId[] = ["mistral", "mistral-pro", "qwen", "lfm"];

const TASKS = [
	{ label: "build", text: "build a web chess in javascript in /tmp/chess", role: "workhorse" as const },
	{ label: "typo", text: "fix the typo in the title", role: "workhorse" as const },
];

const TOOLS = [
	{
		type: "function",
		function: {
			name: "write",
			description: "Write a file. path is a file, not a folder.",
			parameters: {
				type: "object",
				properties: { path: { type: "string" }, content: { type: "string" } },
				required: ["path", "content"],
			},
		},
	},
];

function runtime(suite: SuiteId) {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite }), { frontier: null });
}

function onDisk(modelId: string): boolean {
	return weightFileExists(modelId) || useMlx(modelId);
}

async function stop(pid: number): Promise<void> {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	const deadline = Date.now() + 20_000;
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

describe.skipIf(!live)("suite roles on real weights", () => {
	let port = 18620;

	for (const suite of SUITES) {
		for (const task of TASKS) {
			it(`${suite} ${task.label} uses ${task.role} and writes index.html`, async () => {
				const resolved = runtime(suite);
				const selected = selectSessionRole({ text: task.text, resolved });
				expect(selected.role).toBe(task.role);
				expect(selected.modelId).toBe(resolved.roles.workhorse?.id);
				if (!onDisk(selected.modelId)) {
					console.log(`skip ${suite} ${selected.role} ${selected.modelId}: weight not on disk`);
					return;
				}
				const serverPort = port++;
				const endpoint = `http://127.0.0.1:${serverPort}/v1`;
				const command = localServerCommand({
					role: selected.role === "frontier" ? "planning" : selected.role,
					modelId: selected.modelId,
					port: serverPort,
					quant: "q4_k_m",
					endpoint,
				});
				const args = command.command.includes("mlx") ? command.args : [...command.args, "--reasoning", "off"];
				const child = spawn(command.command, args, { stdio: "ignore" });
				if (!child.pid) {
					throw new Error(`did not spawn ${selected.modelId}`);
				}
				try {
					waitForLocalServer({ port: serverPort, modelId: selected.modelId });
					const chat = localLlamaChatModel({ modelId: selected.modelId, endpoint });
					const response = await fetch(`${endpoint}/chat/completions`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							model: chat.id,
							temperature: 0,
							max_tokens: 4096,
							tool_choice: "required",
							chat_template_kwargs: { enable_thinking: false },
							messages: [
								{
									role: "user",
									content:
										"Create /tmp/chess/index.html. The file is only a title Chess. Keep it under 15 lines. Do not write the folder itself.",
								},
							],
							tools: TOOLS,
						}),
					});
					const json = (await response.json()) as {
						error?: { message?: string } | string;
						choices?: {
							finish_reason?: string;
							message?: {
								content?: string | null;
								tool_calls?: { function?: { name?: string; arguments?: string } }[];
							};
						}[];
					};
					const message = json.choices?.[0]?.message as
						| {
								content?: string | null;
								reasoning?: string | null;
								reasoning_content?: string | null;
								tool_calls?: { function?: { name?: string; arguments?: string } }[];
						  }
						| undefined;
					const call = message?.tool_calls?.[0];
					const body = `${message?.content ?? ""}\n${message?.reasoning ?? ""}\n${message?.reasoning_content ?? ""}`;
					const argsText = call?.function?.arguments ?? body;
					const errorText = typeof json.error === "string" ? json.error : json.error?.message;
					console.log(
						`${suite} ${selected.role} ${selected.modelId} status ${response.status} finish ${json.choices?.[0]?.finish_reason} call ${call?.function?.name ?? "none"} text ${body.slice(0, 180)}`,
					);
					expect(response.status, errorText ?? body.slice(0, 240)).toBe(200);
					const wrote =
						call?.function?.name === "write" ||
						/"name"\s*:\s*"write"/.test(body) ||
						/<\|tool_call_start\|>\[write\(/.test(body);
					expect(wrote, body.slice(0, 240)).toBe(true);
					expect(argsText).toContain("index.html");
					expect(argsText).not.toMatch(/"path"\s*:\s*"\/tmp\/chess"/);
				} finally {
					await stop(child.pid);
				}
			}, 300_000);
		}
	}
});
