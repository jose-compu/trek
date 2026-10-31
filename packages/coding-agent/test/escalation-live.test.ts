/**
 * Optional live escalation matrix on real local GGUFs.
 * This path is experimental and critical: weak models must climb when stuck,
 * and must stay put when the prompt is in-tier (no escalate).
 *
 * CI skips (PI_NO_LOCAL_LLM=1 / TREK_LLAMA_LIVE unset). Enable with:
 *
 *   set -a && source ~/.trek/llama-live.env && set +a
 *   unset PI_NO_LOCAL_LLM
 *   export TREK_LLAMA_LIVE=1
 *   npx vitest run test/escalation-live.test.ts --reporter=verbose
 *
 * Optional filters:
 *   TREK_ESCALATE_SUITE=mistral|qwen|lfm
 *   TREK_ESCALATE_ROLE=tooling|workhorse|planning
 *   TREK_LLAMA_MAX_BYTES — skip weights larger than this (default 4 GiB)
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
	defaultRuntimeConfig,
	type LadderRole,
	LOCAL_SUITE_WORK_SECTION,
	localLlamaChatModel,
	localServerCommand,
	parseEscalateAsk,
	parseEscalateSignal,
	resolveEscalateTarget,
	resolveRuntime,
	resolveWeightPath,
	startLadderRole,
	waitForLocalServer,
	weightFileExists,
	withHierarchy,
} from "../src/core/runtime/index.ts";
import type { SessionLocalRole, SuiteId } from "../src/core/runtime/types.ts";

const live =
	process.env.PI_NO_LOCAL_LLM !== "1" &&
	process.env.TREK_LLAMA_LIVE === "1" &&
	Boolean(process.env.TREK_LLAMA_SERVER) &&
	existsSync(process.env.TREK_LLAMA_SERVER ?? "") &&
	Boolean(process.env.TREK_MODELS_DIR);

const MAX_BYTES = Number(process.env.TREK_LLAMA_MAX_BYTES ?? 4 * 1024 * 1024 * 1024);
const SUITE_FILTER = process.env.TREK_ESCALATE_SUITE?.trim() as SuiteId | undefined;
const ROLE_FILTER = process.env.TREK_ESCALATE_ROLE?.trim() as SessionLocalRole | undefined;

const SUITES: SuiteId[] = ["mistral", "qwen", "lfm"];
const CHAT_ROLES: SessionLocalRole[] = ["tooling", "workhorse", "planning"];

const HARD_DECISION = `You cannot use tools for this turn.
The user asks you to choose a production architecture for multi-region billing with conflicting requirements:
A) strong consistency across continents, and B) sub-100ms writes everywhere.
These cannot both be true. You must not invent a fake solution.
If this is beyond your tier, emit exactly one JSON line and nothing else:
{"escalate":"next","why":"<short reason>"}`;

const NAMED_PLANNING = `You cannot use tools.
The task needs a multi-step design plan before any file is touched.
Escalate to planning. Emit exactly one JSON line:
{"escalate":"planning","why":"<short reason>"}`;

const NAMED_FRONTIER = `You cannot use tools.
This is a deep distributed-systems research question with safety-critical tradeoffs.
Escalate to frontier. Emit exactly one JSON line:
{"escalate":"frontier","why":"<short reason>"}`;

const AMBIGUOUS = `You cannot use tools.
The user said only: "make it better somehow, you figure out the architecture."
You do not have enough requirements. Do not invent layers, services, or a design.
You MUST escalate now. Emit exactly one JSON line and nothing else:
{"escalate":"next","why":"underspecified architecture request"}`;

const TRIVIAL_NO_ESCALATE = `You cannot use tools.
The user said: "fix the typo: helo -> hello in the title."
This is a trivial rename. Do NOT escalate.
Reply with exactly: OK`;

/** In-tier tasks the current role should answer itself. No escalate JSON, no stuck phrases. */
const NO_ESCALATE_CASES: { id: string; prompt: string; expect: RegExp; maxTokens?: number }[] = [
	{
		id: "typo",
		prompt: TRIVIAL_NO_ESCALATE,
		expect: /\bok\b/i,
		maxTokens: 64,
	},
	{
		id: "arithmetic",
		prompt: `You cannot use tools.
The user asked: "What is 17 + 25?"
This is trivial. Do NOT escalate. Do not invent architecture.
Reply with exactly one line: 42`,
		expect: /\b42\b/,
		maxTokens: 32,
	},
	{
		id: "yes-no",
		prompt: `You cannot use tools.
The user asked: "Is TypeScript a typed language?"
Answer from knowledge. Do NOT escalate.
Reply with exactly one word: yes`,
		expect: /\byes\b/i,
		maxTokens: 32,
	},
	{
		id: "clear-choice",
		prompt: `You cannot use tools.
The user must pick one option and gave a clear rule:
- Prefer A when latency matters more than consistency.
- Prefer B when consistency matters more than latency.
Their priority is: latency over consistency.
Choose A or B. Do NOT escalate. Do not invent a hybrid.
Reply with exactly one letter: A`,
		expect: /\bA\b/,
		maxTokens: 32,
	},
	{
		id: "one-liner-code",
		prompt: `You cannot use tools.
The user asked for a one-line JavaScript expression that returns the uppercase of string s.
You can answer this yourself. Do NOT escalate. Do not apologise.
Reply with exactly: s.toUpperCase()`,
		expect: /s\.toUpperCase\(\)/,
		maxTokens: 48,
	},
	{
		id: "echo-path",
		prompt: `You cannot use tools.
The user said: "confirm the path is src/index.ts"
Confirm. Do NOT escalate.
Reply with exactly: src/index.ts`,
		expect: /src\/index\.ts/,
		maxTokens: 48,
	},
];

function weightBytes(modelId: string): number {
	if (!weightFileExists(modelId)) {
		return 0;
	}
	try {
		return statSync(resolveWeightPath(modelId)).size;
	} catch {
		return 0;
	}
}

function fits(modelId: string): boolean {
	const bytes = weightBytes(modelId);
	return bytes > 0 && bytes <= MAX_BYTES;
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

class LiveRoleServer {
	readonly endpoint: string;
	readonly port: number;
	readonly role: SessionLocalRole;
	readonly modelId: string;
	private pid: number | undefined;

	constructor(port: number, role: SessionLocalRole, modelId: string) {
		this.port = port;
		this.role = role;
		this.modelId = modelId;
		this.endpoint = `http://127.0.0.1:${port}/v1`;
	}

	async start(): Promise<void> {
		const command = localServerCommand({
			role: this.role,
			modelId: this.modelId,
			port: this.port,
			quant: "q4_k_m",
			endpoint: this.endpoint,
		});
		const args = command.command.includes("mlx") ? command.args : [...command.args, "--reasoning", "off"];
		console.log(
			`starting ${this.role} ${this.modelId} on :${this.port} (${(weightBytes(this.modelId) / 1e9).toFixed(2)} GB)`,
		);
		const child = spawn(command.command, args, { stdio: "ignore" });
		if (!child.pid) {
			throw new Error(`did not spawn ${this.modelId}`);
		}
		this.pid = child.pid;
		waitForLocalServer({ port: this.port, modelId: this.modelId });
	}

	async complete(prompt: string, maxTokens = 256): Promise<string> {
		const chat = localLlamaChatModel({ modelId: this.modelId, endpoint: this.endpoint });
		const response = await fetch(`${this.endpoint}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: chat.id,
				temperature: 0,
				max_tokens: maxTokens,
				chat_template_kwargs: { enable_thinking: false },
				messages: [
					{ role: "system", content: LOCAL_SUITE_WORK_SECTION },
					{ role: "user", content: prompt },
				],
			}),
		});
		if (!response.ok) {
			throw new Error(`chat failed HTTP ${response.status}: ${await response.text()}`);
		}
		const json = (await response.json()) as {
			choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
		};
		const message = json.choices?.[0]?.message;
		return [message?.content, message?.reasoning_content].filter(Boolean).join("\n");
	}

	async stop(): Promise<void> {
		if (this.pid !== undefined) {
			await stop(this.pid);
			this.pid = undefined;
		}
	}
}

function ladderAtOrAbove(got: LadderRole, min: LadderRole): boolean {
	const order: LadderRole[] = ["tooling", "workhorse", "planning", "frontier"];
	return order.indexOf(got) >= order.indexOf(min);
}

describe.skipIf(!live)("local models escalate when stuck (matrix)", () => {
	let port = 18750;
	const servers: LiveRoleServer[] = [];

	afterAll(async () => {
		await Promise.all(servers.map((server) => server.stop()));
	});

	it("mistral suite still starts on Tooling until Decision lands", () => {
		const resolved = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
			frontier: null,
		});
		expect(startLadderRole(resolved)).toBe("tooling");
	});

	for (const suite of SUITES) {
		if (SUITE_FILTER && suite !== SUITE_FILTER) {
			continue;
		}

		for (const role of CHAT_ROLES) {
			if (ROLE_FILTER && role !== ROLE_FILTER) {
				continue;
			}

			const local = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite }), {
				frontier: null,
			});
			const hybrid = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "hybrid", suite }), {
				frontier: { provider: "xai", modelId: "grok-4" },
			});
			const modelId = local.roles[role]?.id;
			const available = Boolean(modelId && fits(modelId));
			const floor = role as LadderRole;
			const next = resolveEscalateTarget(floor, "next", hybrid);

			it.skipIf(!available)(
				`${suite}/${role} (${modelId}) battery: next, named, ambiguous, trivial`,
				async () => {
					const server = new LiveRoleServer(port++, role, modelId!);
					servers.push(server);
					await server.start();
					try {
						const hard = await server.complete(HARD_DECISION);
						console.log(`${suite}/${role} hard:\n${hard.slice(0, 360)}`);
						const hardSignal = parseEscalateSignal(hard, floor, hybrid);
						expect(hardSignal, `hard escalate missing in: ${hard}`).toBeTruthy();
						expect(hardSignal?.explicit).toBe(true);
						expect(hardSignal?.tier).toBe(next);

						if (role !== "planning") {
							const named = await server.complete(NAMED_PLANNING);
							console.log(`${suite}/${role} named planning:\n${named.slice(0, 360)}`);
							const namedSignal = parseEscalateSignal(named, floor, hybrid);
							expect(namedSignal, `named planning missing in: ${named}`).toBeTruthy();
							expect(namedSignal?.tier).toBe("planning");
						} else {
							const named = await server.complete(NAMED_FRONTIER);
							console.log(`${suite}/${role} named frontier:\n${named.slice(0, 360)}`);
							const namedSignal = parseEscalateSignal(named, "planning", hybrid);
							expect(namedSignal, `named frontier missing in: ${named}`).toBeTruthy();
							expect(namedSignal?.tier).toBe("frontier");
						}

						const ambiguous = await server.complete(AMBIGUOUS);
						console.log(`${suite}/${role} ambiguous:\n${ambiguous.slice(0, 360)}`);
						const ambAsk = parseEscalateAsk(ambiguous);
						const ambSignal = parseEscalateSignal(ambiguous, floor, hybrid);
						expect(ambAsk || ambSignal, `ambiguous escalate missing in: ${ambiguous}`).toBeTruthy();
						if (ambSignal && next) {
							expect(ladderAtOrAbove(ambSignal.tier, next)).toBe(true);
						}

						// Demotion refuse is pure policy; assert once per battery.
						expect(resolveEscalateTarget("workhorse", "tooling", hybrid)).toBe("planning");
					} finally {
						await server.stop();
					}
				},
				300_000,
			);

			it.skipIf(!available)(
				`${suite}/${role} (${modelId}) no-escalate: in-tier prompts stay put`,
				async () => {
					const server = new LiveRoleServer(port++, role, modelId!);
					servers.push(server);
					await server.start();
					try {
						for (const case_ of NO_ESCALATE_CASES) {
							const reply = await server.complete(case_.prompt, case_.maxTokens ?? 64);
							console.log(`${suite}/${role} no-escalate/${case_.id}:\n${reply.slice(0, 200)}`);
							expect(parseEscalateAsk(reply), `must not escalate ${case_.id}: ${reply}`).toBeUndefined();
							expect(
								parseEscalateSignal(reply, floor, hybrid),
								`must not signal escalate ${case_.id}: ${reply}`,
							).toBeUndefined();
							expect(reply, `expected shape for ${case_.id}: ${reply}`).toMatch(case_.expect);
						}
					} finally {
						await server.stop();
					}
				},
				300_000,
			);
		}
	}

	it("mistral chain Tooling then Workhorse both climb on the same hard task", async () => {
		if (SUITE_FILTER && SUITE_FILTER !== "mistral") {
			return;
		}
		const hybrid = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "hybrid", suite: "mistral" }), {
			frontier: { provider: "xai", modelId: "grok-4" },
		});
		const toolingId = hybrid.roles.tooling?.id;
		const workhorseId = hybrid.roles.workhorse?.id;
		if (!toolingId || !workhorseId || !fits(toolingId) || !fits(workhorseId)) {
			console.log("skip chain: tooling/workhorse weights missing or over budget");
			return;
		}
		if (ROLE_FILTER && ROLE_FILTER !== "tooling" && ROLE_FILTER !== "workhorse") {
			return;
		}

		const tooling = new LiveRoleServer(port++, "tooling", toolingId);
		const workhorse = new LiveRoleServer(port++, "workhorse", workhorseId);
		servers.push(tooling, workhorse);
		await tooling.start();
		try {
			const t1 = await tooling.complete(HARD_DECISION);
			console.log(`chain tooling:\n${t1.slice(0, 300)}`);
			expect(parseEscalateSignal(t1, "tooling", hybrid)?.tier).toBe("workhorse");

			await workhorse.start();
			const t2 = await workhorse.complete(HARD_DECISION);
			console.log(`chain workhorse:\n${t2.slice(0, 300)}`);
			expect(parseEscalateSignal(t2, "workhorse", hybrid)?.tier).toBe("planning");
		} finally {
			await tooling.stop();
			await workhorse.stop();
		}
	}, 300_000);

	it("parser accepts escalate JSON wrapped in markdown fences", () => {
		const hybrid = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "hybrid", suite: "mistral" }), {
			frontier: { provider: "xai", modelId: "grok-4" },
		});
		const fenced = '```json\n{"escalate":"next","why":"needs plan"}\n```';
		expect(parseEscalateSignal(fenced, "tooling", hybrid)?.tier).toBe("workhorse");
		expect(parseEscalateAsk(fenced)?.explicit).toBe(true);
	});
});
