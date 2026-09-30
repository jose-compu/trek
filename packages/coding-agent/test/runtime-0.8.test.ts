/**
 * 0.8.0 Runtime acceptance (issues #85–#92).
 * Run: npx vitest run test/runtime-0.8.test.ts --reporter=verbose
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { isValidAuditStep } from "../src/core/reproducibility/index.ts";
import {
	benchmarkRuntime,
	createDefaultLlamaProcessManager,
	createPortAllocator,
	defaultRuntimeConfig,
	detectFrontier,
	formatBenchmark,
	HIERARCHY_PROBES,
	LlamaProcessManager,
	LOCAL_LLAMA_TIMEOUT_MS,
	LOCAL_SUITE_WORK_SECTION,
	LOCAL_WORK_TOOL_NUDGE,
	llamaServerLogPath,
	loadRuntimeConfig,
	localLlamaChatModel,
	localSuiteToolChoice,
	nudgeLocalWorkMessages,
	projectModelsYamlPath,
	requiresHuggingFaceToken,
	resolveRuntime,
	resolveWeightPath,
	scoreProbeText,
	selectSessionRole,
	sessionLocalRoles,
	summarizePerformance,
	withHierarchy,
	writeRuntimeConfigFile,
} from "../src/core/runtime/index.ts";
import { handleModelsCommand } from "../src/models-cli.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function captureStdio(): { logs: string[]; errors: string[]; restore: () => void } {
	const logs: string[] = [];
	const errors: string[] = [];
	const log = console.log;
	const err = console.error;
	console.log = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	};
	return {
		logs,
		errors,
		restore: () => {
			console.log = log;
			console.error = err;
		},
	};
}

function localConfig(suite: "mistral" | "mistral-pro" | "qwen" | "lfm" = "mistral") {
	return withHierarchy(defaultRuntimeConfig(), { mode: "local", suite });
}

describe("0.8.0 runtime gate (#92)", () => {
	it("scores the hierarchy probes without calling a model", () => {
		expect(HIERARCHY_PROBES).toHaveLength(3);
		expect(scoreProbeText("42", HIERARCHY_PROBES[0]!)).toBe(true);
		expect(scoreProbeText("use read", HIERARCHY_PROBES[1]!)).toBe(true);
		expect(scoreProbeText("Yes.", HIERARCHY_PROBES[2]!)).toBe(true);
		expect(scoreProbeText("no", HIERARCHY_PROBES[2]!)).toBe(false);
		const report = summarizePerformance("mistral workhorse", "Ministral-3-3B-Instruct-2512", [
			{ id: "arithmetic", correct: true, elapsedMs: 1000, outputTokens: 10, tokensPerSecond: 10 },
			{ id: "tool", correct: false, elapsedMs: 1000, outputTokens: 10, tokensPerSecond: 10 },
		]);
		expect(report.correct).toBe(1);
		expect(report.total).toBe(2);
		expect(report.tokensPerSecond).toBe(10);
	});

	it("default manager does not spawn without a binary and weights directory", () => {
		const previousServer = process.env.TREK_LLAMA_SERVER;
		const previousDir = process.env.TREK_MODELS_DIR;
		delete process.env.TREK_LLAMA_SERVER;
		delete process.env.TREK_MODELS_DIR;
		try {
			const resolved = resolveRuntime(localConfig(), { frontier: null });
			const manager = createDefaultLlamaProcessManager();
			expect(() => manager.ensure("workhorse", resolved)).toThrow(/llama-server binary not found/);
			expect(manager.list()).toEqual([]);
		} finally {
			if (previousServer === undefined) {
				delete process.env.TREK_LLAMA_SERVER;
			} else {
				process.env.TREK_LLAMA_SERVER = previousServer;
			}
			if (previousDir === undefined) {
				delete process.env.TREK_MODELS_DIR;
			} else {
				process.env.TREK_MODELS_DIR = previousDir;
			}
		}
	});

	it("resolves a GGUF path under TREK_MODELS_DIR", () => {
		const root = mkdtempSync(join(tmpdir(), "trek-weights-"));
		try {
			writeFileSync(join(root, "Ministral-3-3B-Instruct-2512.gguf"), "");
			expect(resolveWeightPath("Ministral-3-3B-Instruct-2512", root)).toBe(
				join(root, "Ministral-3-3B-Instruct-2512.gguf"),
			);
			expect(resolveWeightPath("missing", root)).toBe("missing");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("tells a pure local suite to build in the folder", () => {
		expect(LOCAL_SUITE_WORK_SECTION).toMatch(/write and edit tools/);
		expect(LOCAL_SUITE_WORK_SECTION).toMatch(/Do not answer with a tutorial/);
	});

	it("requires a tool call for a local build request until files and a command exist", () => {
		const ask = {
			role: "user",
			content: "please build a web calculator in flask python and js and open it in chrome pls",
		};
		expect(localSuiteToolChoice([ask])).toBe("required");
		const nudged = nudgeLocalWorkMessages([ask]);
		expect(String(nudged[0]?.content)).toContain(LOCAL_WORK_TOOL_NUDGE);
		expect(ask.content).not.toContain(LOCAL_WORK_TOOL_NUDGE);
		expect(nudgeLocalWorkMessages([{ role: "user", content: "what is flask" }])[0]?.content).toBe("what is flask");
		expect(localSuiteToolChoice([{ role: "user", content: "what is flask" }])).toBeUndefined();
		expect(
			localSuiteToolChoice([
				ask,
				{ role: "assistant", content: [{ type: "toolCall", name: "read" }] },
				{ role: "toolResult", toolName: "read" },
			]),
		).toBe("required");
		expect(
			localSuiteToolChoice([
				ask,
				{ role: "assistant", content: [{ type: "toolCall", name: "write" }] },
				{ role: "toolResult", toolName: "write" },
				{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] },
				{ role: "toolResult", toolName: "bash" },
			]),
		).toBeUndefined();
	});

	it("keeps llama-server logs off the terminal", () => {
		const previous = process.env.TREK_LLAMA_LOG;
		process.env.TREK_LLAMA_LOG = "/tmp/trek-llama-server.log";
		expect(llamaServerLogPath()).toBe("/tmp/trek-llama-server.log");
		delete process.env.TREK_LLAMA_LOG;
		expect(llamaServerLogPath()).toMatch(/[/\\]\.trek[/\\]logs[/\\]llama-server\.log$/);
		if (previous !== undefined) {
			process.env.TREK_LLAMA_LOG = previous;
		}
	});

	it("default settings spawn no llama-server and do not require an HF token", () => {
		const resolved = resolveRuntime(defaultRuntimeConfig(), { frontier: null });
		expect(resolved.mode).toBe("api");
		expect(resolved.effectiveMode).toBe("api");
		expect(sessionLocalRoles(resolved)).toEqual([]);
		expect(requiresHuggingFaceToken("api")).toBe(false);
		expect(resolved.requiresHuggingFaceToken).toBe(false);
		const spawn = () => {
			throw new Error("spawned");
		};
		const manager = new LlamaProcessManager({
			spawn,
			allocatePort: createPortAllocator(),
			binaryAvailable: () => true,
			weightsAvailable: () => true,
		});
		expect(() => manager.ensure("planning", resolved)).toThrow(/api mode does not start llama-server/);
		expect(manager.list()).toEqual([]);
	});

	it("set-mode local with mocked ports starts three roles once each", () => {
		const resolved = resolveRuntime(localConfig(), { frontier: null });
		expect(resolved.effectiveMode).toBe("local");
		expect(sessionLocalRoles(resolved)).toEqual(["tooling", "workhorse", "planning"]);
		const calls: string[] = [];
		let pid = 100;
		const manager = new LlamaProcessManager({
			spawn: (request) => {
				calls.push(`${request.role}:${request.port}`);
				pid += 1;
				return { pid };
			},
			allocatePort: createPortAllocator(18080),
			binaryAvailable: () => true,
			weightsAvailable: () => true,
		});
		for (const role of sessionLocalRoles(resolved)) {
			manager.ensure(role, resolved);
			manager.ensure(role, resolved);
		}
		expect(calls).toEqual(["tooling:18080", "workhorse:18081", "planning:18082"]);
		expect(manager.list()).toHaveLength(3);
		const stopped: number[] = [];
		const stopping = new LlamaProcessManager({
			spawn: () => ({ pid: 4242 }),
			allocatePort: createPortAllocator(18080),
			binaryAvailable: () => true,
			weightsAvailable: () => true,
			signal: (pid) => {
				stopped.push(pid);
			},
		});
		stopping.ensure("workhorse", resolved);
		stopping.stop();
		expect(stopped).toEqual([4242]);
		expect(stopping.list()).toEqual([]);
		expect(resolved.roles.workhorse?.thinking).toBe(false);
		expect(resolved.roles.planning?.thinking).toBe(true);
	});

	it("refuses a second Planning model id", () => {
		const resolved = resolveRuntime(localConfig(), { frontier: null });
		const manager = new LlamaProcessManager({
			spawn: () => ({ pid: 1 }),
			allocatePort: createPortAllocator(),
			binaryAvailable: () => true,
			weightsAvailable: () => true,
		});
		manager.ensure("planning", resolved);
		const other = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "qwen" }), {
			frontier: null,
		});
		expect(() => manager.ensure("planning", other)).toThrow(/already loaded/);
	});

	it("names a missing binary and missing GGUF without downloading", () => {
		const resolved = resolveRuntime(localConfig(), { frontier: null });
		const noBinary = new LlamaProcessManager({
			spawn: () => ({ pid: 1 }),
			allocatePort: createPortAllocator(),
			binaryAvailable: () => false,
			weightsAvailable: () => true,
		});
		expect(() => noBinary.ensure("workhorse", resolved)).toThrow(/llama-server binary not found/);
		const noWeights = new LlamaProcessManager({
			spawn: () => ({ pid: 1 }),
			allocatePort: createPortAllocator(),
			binaryAvailable: () => true,
			weightsAvailable: () => false,
		});
		expect(() => noWeights.ensure("workhorse", resolved)).toThrow(/0\.16\.0/);
	});

	it("promotes local to hybrid when a Frontier key exists", () => {
		const resolved = resolveRuntime(localConfig(), { env: { OPENAI_API_KEY: "test-key", XAI_API_KEY: "" } });
		expect(resolved.effectiveMode).toBe("hybrid");
		expect(resolved.roles.frontier?.source).toBe("api");
		expect(resolved.roles.frontier?.provider).toBe("openai");
		expect(resolved.roles.tooling?.source).toBe("local");
		expect(sessionLocalRoles(resolved)).toEqual(["tooling", "workhorse", "planning"]);
		expect(detectFrontier({ XAI_API_KEY: "x", OPENAI_API_KEY: "o" })?.provider).toBe("xai");
	});

	it("switches Mistral, Qwen, and LFM without a download", () => {
		const mistral = resolveRuntime(localConfig("mistral"), { frontier: null });
		const qwen = resolveRuntime(localConfig("qwen"), { frontier: null });
		const lfm = resolveRuntime(localConfig("lfm"), { frontier: null });
		const pro = resolveRuntime(localConfig("mistral-pro"), { frontier: null });
		expect(mistral.roles.tooling?.id).toBe("Qwen3.5-0.8B");
		expect(mistral.roles.workhorse?.id).toBe("Ministral-3-3B-Instruct-2512");
		expect(mistral.roles.planning?.id).toBe("Ministral-3-8B-Reasoning-2512");
		expect(mistral.rerank).toBe(true);
		expect(qwen.roles.workhorse?.id).toBe("Qwen3.5-4B");
		expect(qwen.roles.workhorse?.thinking).toBe(false);
		expect(qwen.roles.planning?.thinking).toBe(true);
		expect(lfm.roles.embedding?.id).toBe("LFM2-ColBERT-350M");
		expect(lfm.roles.reranker).toBeUndefined();
		expect(lfm.rerank).toBe(false);
		expect(lfm.roles.planning?.thinking).toBe(true);
		expect(pro.roles.workhorse?.id).toBe("Devstral-Small-2507");
		expect(pro.roles.workhorse?.thinking).toBe(false);
		expect(pro.roles.planning?.id).toBe("Ministral-3-8B-Reasoning-2512");
	});

	it("points a local chat model at llama-server", () => {
		const previous = process.env.TREK_LLAMA_CTX;
		process.env.TREK_LLAMA_CTX = "8192";
		const model = localLlamaChatModel({
			modelId: "LFM2.5-1.2B-Instruct",
			endpoint: "http://127.0.0.1:18080/v1",
		});
		if (previous === undefined) {
			delete process.env.TREK_LLAMA_CTX;
		} else {
			process.env.TREK_LLAMA_CTX = previous;
		}
		expect(model.provider).toBe("local");
		expect(model.api).toBe("openai-completions");
		expect(model.name).toBe("LFM2.5-1.2B-Instruct");
		expect(model.baseUrl).toBe("http://127.0.0.1:18080/v1");
		expect(model.contextWindow).toBe(8192);
		expect(model.maxTokens).toBe(4096);
		expect(LOCAL_LLAMA_TIMEOUT_MS).toBe(120_000);
		expect(model.reasoning).toBe(false);
		expect(model.compat?.maxTokensField).toBe("max_tokens");
		expect(model.compat?.supportsReasoningEffort).toBe(false);
	});

	it("selects Work-horse, Planning, and Frontier without a component router", () => {
		const local = resolveRuntime(localConfig(), { frontier: null });
		const hybrid = resolveRuntime(localConfig(), { frontier: { provider: "anthropic", modelId: "frontier" } });
		expect(selectSessionRole({ text: "fix the typo", resolved: local }).role).toBe("workhorse");
		expect(selectSessionRole({ text: "fix the typo", resolved: local }).thinking).toBe(false);
		expect(selectSessionRole({ text: "plan the research", resolved: local })).toMatchObject({
			role: "planning",
			thinking: true,
			source: "local",
		});
		expect(selectSessionRole({ text: "/frontier dig in", resolved: hybrid }).role).toBe("frontier");
		expect(selectSessionRole({ text: "fix", resolved: hybrid, complexity: 0.8 }).source).toBe("api");
		expect(selectSessionRole({ text: "/frontier", resolved: local }).reason).toMatch(/not available in local mode/);
		const api = resolveRuntime(defaultRuntimeConfig(), { frontier: null });
		expect(selectSessionRole({ text: "plan the research", resolved: api })).toMatchObject({
			role: "frontier",
			source: "api",
		});
	});

	it("skips benchmark rows when weights are absent", () => {
		const api = resolveRuntime(defaultRuntimeConfig(), { frontier: null });
		expect(formatBenchmark(benchmarkRuntime(api, { weightsAvailable: () => true }))).toMatch(/api mode/);
		const local = resolveRuntime(localConfig(), { frontier: null });
		const rows = benchmarkRuntime(local, { weightsAvailable: () => false });
		expect(rows).toHaveLength(3);
		expect(rows.every((row) => row.status === "skipped")).toBe(true);
	});

	it("lets a project file override one role and rejects a private id", () => {
		const root = mkdtempSync(join(tmpdir(), "trek-runtime-"));
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		try {
			const globalConfig = localConfig();
			writeRuntimeConfigFile(join(root, "models.yaml"), globalConfig);
			writeRuntimeConfigFile(projectModelsYamlPath(cwd), {
				hierarchy: { mode: "local", suite: "mistral", quant: "q4_k_m" },
				roles: {
					tooling: { source: "local", id: "Qwen3.5-0.8B", thinking: false },
				},
			});
			const loaded = loadRuntimeConfig({ agentDir, cwd });
			const resolved = resolveRuntime(loaded, { frontier: null });
			expect(resolved.roles.tooling?.id).toBe("Qwen3.5-0.8B");
			expect(resolved.roles.workhorse?.id).toBe("Ministral-3-3B-Instruct-2512");
			expect(() =>
				writeRuntimeConfigFile(join(root, "models.yaml"), {
					...globalConfig,
					roles: { tooling: { source: "local", id: "@private/needle", thinking: false } },
				}),
			).toThrow(/private or unpublished/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("trek models CLI (#89)", () => {
	const previous = process.env[ENV_AGENT_DIR];
	const dirs: string[] = [];

	afterEach(() => {
		if (previous === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = previous;
		}
		while (dirs.length > 0) {
			rmSync(dirs.pop()!, { recursive: true, force: true });
		}
	});

	it("persists set-mode and set-suite", async () => {
		process.exitCode = undefined;
		const root = mkdtempSync(join(tmpdir(), "trek-models-cli-"));
		dirs.push(root);
		process.env[ENV_AGENT_DIR] = join(root, "agent");
		const stdio = captureStdio();
		expect(await handleModelsCommand(["models", "set-mode", "local"])).toBe(true);
		expect(await handleModelsCommand(["models", "set-suite", "qwen"])).toBe(true);
		stdio.restore();
		const text = stdio.logs.join("\n");
		expect(text).toContain("hierarchy.mode: local");
		expect(text).toContain("suite: qwen");
		expect(text).toContain("thinking off");
		expect(text).toContain("Qwen3.5-9B");
	});
});

describe("audit step role annotation (#90)", () => {
	const harnesses: Harness[] = [];
	const previous = process.env[ENV_AGENT_DIR];
	const dirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		if (previous === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = previous;
		}
		while (dirs.length > 0) {
			rmSync(dirs.pop()!, { recursive: true, force: true });
		}
	});

	it("records frontier/api on the default session", async () => {
		const root = mkdtempSync(join(tmpdir(), "trek-runtime-audit-"));
		dirs.push(root);
		process.env[ENV_AGENT_DIR] = join(root, "agent");
		const harness = await createHarness();
		harnesses.push(harness);
		const { fauxAssistantMessage } = await import("@trek/ai");
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hello");
		const steps = harness.sessionManager.getAuditSteps<{ role?: string; source?: string }>();
		expect(steps).toHaveLength(1);
		expect(isValidAuditStep(steps[0])).toBe(true);
		expect(steps[0]).toMatchObject({ role: "frontier", source: "api" });
	});
});
