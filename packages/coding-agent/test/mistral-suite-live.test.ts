/**
 * Optional end-to-end tool calls for the Mistral suites.
 * ./test.sh sets PI_NO_LOCAL_LLM=1, so CI skips this file.
 *
 * Models already on disk (workhorse, planning):
 *   set -a && source ~/.trek/llama-live.env && set +a
 *   unset PI_NO_LOCAL_LLM
 *   node ../../node_modules/vitest/dist/cli.js --run test/mistral-suite-live.test.ts --reporter=verbose
 *
 * Also download a missing chat weight, then run the same two-turn check.
 * Devstral-Small-2507 is the pro workhorse and is about 13 GB:
 *   TREK_MISTRAL_DOWNLOAD=1 node ../../node_modules/vitest/dist/cli.js --run test/mistral-suite-live.test.ts --reporter=verbose
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { llamaServerArgs, weightFileExists } from "../src/core/runtime/process-manager.ts";
import { toolDialect } from "../src/core/runtime/tool-dialect.ts";
import { downloadWeight, WEIGHT_SOURCES } from "../src/core/runtime/weight-download.ts";

const live =
	process.env.PI_NO_LOCAL_LLM !== "1" &&
	Boolean(process.env.TREK_LLAMA_SERVER) &&
	existsSync(process.env.TREK_LLAMA_SERVER ?? "") &&
	Boolean(process.env.TREK_MODELS_DIR);

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
	{
		type: "function",
		function: {
			name: "bash",
			description: "Run a shell command.",
			parameters: {
				type: "object",
				properties: { command: { type: "string" } },
				required: ["command"],
			},
		},
	},
];

interface ToolCall {
	function?: { name?: string; arguments?: string };
	id?: string;
}

interface Completion {
	status: number;
	finish?: string;
	call?: ToolCall;
	content?: string;
	promptTokens?: number;
	error?: string;
}

const ON_DISK = [
	{ role: "workhorse", id: "Ministral-3-3B-Instruct-2512" },
	{ role: "planning", id: "Ministral-3-8B-Reasoning-2512" },
] as const;

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

async function waitForHealth(port: number): Promise<void> {
	const deadline = Date.now() + 180_000;
	let last = "no response";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/health`);
			if (response.ok) return;
			last = `HTTP ${response.status}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	throw new Error(`llama-server on ${port} did not start: ${last}`);
}

async function complete(port: number, body: unknown): Promise<Completion> {
	const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await response.json()) as {
		error?: { message?: string };
		usage?: { prompt_tokens?: number };
		choices?: {
			finish_reason?: string;
			message?: { content?: string | null; tool_calls?: ToolCall[] };
		}[];
	};
	const message = json.choices?.[0]?.message;
	return {
		status: response.status,
		finish: json.choices?.[0]?.finish_reason,
		call: message?.tool_calls?.[0],
		content: message?.content ?? "",
		promptTokens: json.usage?.prompt_tokens,
		error: json.error?.message,
	};
}

async function withServer(modelId: string, port: number, run: (port: number) => Promise<void>): Promise<void> {
	const binary = process.env.TREK_LLAMA_SERVER ?? "";
	const args = [
		...llamaServerArgs({
			role: "workhorse",
			modelId,
			port,
			quant: "q4_k_m",
			endpoint: `http://127.0.0.1:${port}/v1`,
		}),
		"--reasoning",
		"off",
	];
	const child = spawn(binary, args, { stdio: "ignore" });
	if (!child.pid) throw new Error(`did not spawn ${modelId}`);
	try {
		await waitForHealth(port);
		await run(port);
	} finally {
		await stop(child.pid);
	}
}

function assertWriteCall(modelId: string, turn: Completion): void {
	expect(turn.status, turn.error ?? turn.content).toBe(200);
	const args = turn.call?.function?.arguments ?? "";
	console.log(
		`${modelId} dialect ${toolDialect(modelId)} prompt ${turn.promptTokens ?? 0} finish ${turn.finish} call ${turn.call?.function?.name ?? "none"}`,
	);
	expect(turn.call?.function?.name, turn.content?.slice(0, 240)).toBe("write");
	expect(args).toContain("index.html");
	expect(args).not.toMatch(/"path"\s*:\s*"\/tmp\/blah"/);
}

describe.skipIf(!live)("Mistral suite tool calling", () => {
	let port = 18520;

	for (const row of ON_DISK) {
		it(`${row.role} ${row.id} writes index.html and sees the tool result`, async () => {
			expect(weightFileExists(row.id), `${row.id} is part of the local Mistral suite`).toBe(true);
			const serverPort = port++;
			await withServer(row.id, serverPort, async (active) => {
				const first = await complete(active, {
					temperature: 0,
					max_tokens: 1024,
					tool_choice: "required",
					messages: [
						{
							role: "user",
							content:
								"Create /tmp/blah/index.html. The file is only a title Chess. Keep it under 15 lines. Do not write the folder itself.",
						},
					],
					tools: TOOLS,
				});
				assertWriteCall(row.id, first);
				const second = await complete(active, {
					temperature: 0,
					max_tokens: 256,
					messages: [
						{
							role: "user",
							content: "Create /tmp/blah/index.html. The file is only a title Chess. Keep it under 15 lines.",
						},
						{
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: first.call?.id ?? "call-1",
									type: "function",
									function: first.call?.function,
								},
							],
						},
						{
							role: "tool",
							tool_call_id: first.call?.id ?? "call-1",
							content: "Successfully wrote 80 bytes to /tmp/blah/index.html",
						},
					],
					tools: TOOLS,
				});
				expect(second.status, second.error ?? second.content).toBe(200);
				const follow = `${second.call?.function?.name ?? ""} ${second.call?.function?.arguments ?? ""} ${second.content ?? ""}`;
				console.log(`${row.id} follow-up finish ${second.finish} ${follow.slice(0, 180)}`);
				expect(follow).toMatch(/index\.html|bash/);
				expect(follow.toLowerCase()).not.toMatch(/can't execute|cannot run/);
			});
		}, 180_000);
	}

	it("downloads Devstral when asked and then writes index.html", async () => {
		const id = "Devstral-Small-2507";
		if (!weightFileExists(id)) {
			if (process.env.TREK_MISTRAL_DOWNLOAD !== "1") {
				console.log("skip Devstral download: set TREK_MISTRAL_DOWNLOAD=1");
				return;
			}
			const source = WEIGHT_SOURCES[id];
			expect(source).toBeDefined();
			await downloadWeight({ role: "workhorse", id, repo: source!.repo, file: source!.file });
		}
		expect(weightFileExists(id)).toBe(true);
		expect(toolDialect(id)).toBe("mistral");
		await withServer(id, port++, async (active) => {
			const first = await complete(active, {
				temperature: 0,
				max_tokens: 1024,
				tool_choice: "required",
				messages: [
					{
						role: "user",
						content: "Create /tmp/blah/index.html. The file is only a title Chess. Keep it under 15 lines.",
					},
				],
				tools: TOOLS,
			});
			assertWriteCall(id, first);
		});
	}, 900_000);
});
