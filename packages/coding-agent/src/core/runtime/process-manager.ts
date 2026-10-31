/**
 * One llama-server process per role (PROMPT §19, issue #88).
 * Spawn is injected so CI never starts a real server.
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { localContextWindow } from "./context-budget.ts";
import { lfmChatTemplatePath } from "./lfm-chat-template.ts";
import { ensureMlxChatTemplate, mlxServerArgs, mlxServerBin, preferMlx, useMlx } from "./mlx-backend.ts";
import type { ResolvedRuntime } from "./resolve.ts";
import { toolDialect } from "./tool-dialect.ts";
import { isLocalServerRole, type LocalServerRole } from "./types.ts";

/** Prefer `<dir>/<id>.gguf`, then `<dir>/<id>`. Otherwise the id is passed through. */
export function resolveWeightPath(modelId: string, dir = process.env.TREK_MODELS_DIR): string {
	if (!dir) {
		return modelId;
	}
	const gguf = join(dir, `${modelId}.gguf`);
	if (existsSync(gguf)) {
		return gguf;
	}
	const bare = join(dir, modelId);
	if (existsSync(bare)) {
		return bare;
	}
	return modelId;
}

export function weightFileExists(modelId: string, dir = process.env.TREK_MODELS_DIR): boolean {
	if (!dir) {
		return false;
	}
	const resolved = resolveWeightPath(modelId, dir);
	return resolved !== modelId && existsSync(resolved);
}

export interface SpawnRequest {
	role: LocalServerRole;
	modelId: string;
	port: number;
	quant: string;
	endpoint: string;
}

export interface LlamaServerHandle {
	role: LocalServerRole;
	modelId: string;
	port: number;
	pid: number;
	endpoint: string;
}

export interface LlamaProcessManagerOptions {
	spawn: (request: SpawnRequest) => { pid: number };
	allocatePort: () => number;
	binaryAvailable: () => boolean;
	weightsAvailable: (role: LocalServerRole, modelId: string) => boolean;
	/** Stops a server on session dispose. Default is SIGTERM. */
	signal?: (pid: number, signal: NodeJS.Signals) => void;
}

export function createPortAllocator(start = 18080): () => number {
	let next = start;
	return () => next++;
}

function portStart(): number {
	const raw = process.env.TREK_LLAMA_PORT_START;
	const parsed = raw ? Number(raw) : 18080;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 18080;
}

export class LlamaProcessManager {
	private readonly handles = new Map<LocalServerRole, LlamaServerHandle>();
	private readonly options: LlamaProcessManagerOptions;

	constructor(options: LlamaProcessManagerOptions) {
		this.options = options;
	}

	ensure(role: string, resolved: ResolvedRuntime): LlamaServerHandle {
		if (resolved.effectiveMode === "api") {
			throw new Error("api mode does not start llama-server. Use trek models set-mode local or hybrid.");
		}
		if (role === "frontier") {
			throw new Error("frontier is an API role and does not start llama-server.");
		}
		if (!isLocalServerRole(role)) {
			throw new Error(`Unknown local role ${role}.`);
		}
		const assignment = resolved.roles[role];
		if (!assignment || assignment.source !== "local") {
			throw new Error(`Role ${role} is not a local assignment.`);
		}
		const existing = this.handles.get(role);
		if (existing) {
			if (existing.modelId !== assignment.id) {
				throw new Error(`Role ${role} is already loaded (${existing.modelId}). Refusing a second ${role} load.`);
			}
			return existing;
		}
		if (!this.options.binaryAvailable()) {
			throw new Error(
				"llama-server binary not found. Set TREK_LLAMA_SERVER to the binary. trek models list shows the role. Full Hugging Face download is 0.16.0.",
			);
		}
		if (!this.options.weightsAvailable(role, assignment.id)) {
			throw new Error(
				`GGUF for ${role} (${assignment.id}) is not on disk. trek models list. Full Hugging Face download is 0.16.0.`,
			);
		}
		const port = this.options.allocatePort();
		const endpoint = `http://127.0.0.1:${port}/v1`;
		const spawned = this.options.spawn({
			role,
			modelId: assignment.id,
			port,
			quant: resolved.quant,
			endpoint,
		});
		const handle: LlamaServerHandle = {
			role,
			modelId: assignment.id,
			port,
			pid: spawned.pid,
			endpoint,
		};
		this.handles.set(role, handle);
		return handle;
	}

	/** SIGTERM every llama-server this session started. Print mode can then exit. */
	stop(): void {
		const signal = this.options.signal ?? ((pid, sig) => process.kill(pid, sig));
		for (const handle of this.handles.values()) {
			try {
				signal(handle.pid, "SIGTERM");
			} catch {
				// The process is already gone.
			}
		}
		this.handles.clear();
	}

	list(): LlamaServerHandle[] {
		return [...this.handles.values()];
	}
}

/** Server stderr. Never the TUI. TREK_LLAMA_LOG overrides the path. */
export function llamaServerLogPath(): string {
	const override = process.env.TREK_LLAMA_LOG?.trim();
	if (override) {
		return override;
	}
	return join(homedir(), ".trek", "logs", "llama-server.log");
}

function openLlamaServerLog(): number | undefined {
	try {
		const path = llamaServerLogPath();
		mkdirSync(dirname(path), { recursive: true });
		return openSync(path, "a");
	} catch {
		return undefined;
	}
}

const LOCAL_SERVER_READY_MS = 180_000;

export interface LocalServerProbe {
	status: number;
	body: string;
}

function syncSleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function curlProbe(kind: "health" | "mlx", port: number): LocalServerProbe {
	const args = ["-sS", "-m", kind === "mlx" ? "120" : "2", "-w", "\n%{http_code}"];
	if (kind === "mlx") {
		args.push(
			"-H",
			"content-type: application/json",
			"-d",
			JSON.stringify({
				model: "default_model",
				max_tokens: 1,
				temperature: 0,
				messages: [{ role: "user", content: "." }],
			}),
		);
	}
	args.push(kind === "health" ? `http://127.0.0.1:${port}/health` : `http://127.0.0.1:${port}/v1/chat/completions`);
	const result = spawnSync("curl", args, { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		return { status: 0, body: (result.stderr || result.error?.message || "unreachable").trim() };
	}
	const text = result.stdout ?? "";
	const split = text.lastIndexOf("\n");
	const status = Number(text.slice(split + 1).trim());
	return { status: Number.isFinite(status) ? status : 0, body: text.slice(0, Math.max(0, split)) };
}

/**
 * llama.cpp answers 503 "Loading model" until the GGUF is in memory.
 * MLX answers /health before the snapshot is loaded, so the probe is a one-token completion.
 */
export function waitForLocalServer(
	request: { port: number; modelId: string },
	deps?: {
		probe?: (kind: "health" | "mlx", port: number) => LocalServerProbe;
		sleep?: (ms: number) => void;
		now?: () => number;
		timeoutMs?: number;
	},
): void {
	const mlx = useMlx(request.modelId);
	const probe = deps?.probe ?? curlProbe;
	const sleep = deps?.sleep ?? syncSleep;
	const now = deps?.now ?? Date.now;
	const deadline = now() + (deps?.timeoutMs ?? LOCAL_SERVER_READY_MS);
	let last = "no response";
	let clock = now();
	while (clock <= deadline) {
		let result: LocalServerProbe;
		try {
			result = probe(mlx ? "mlx" : "health", request.port);
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
			sleep(400);
			clock = now();
			continue;
		}
		if (result.status === 200) {
			return;
		}
		last = `${result.status} ${result.body.slice(0, 120)}`.trim();
		if (mlx && result.status === 404) {
			throw new Error(`Local model ${request.modelId} rejected the request (${last}).`);
		}
		sleep(400);
		clock = now();
	}
	throw new Error(`Local model ${request.modelId} did not finish loading (${last}).`);
}

/** Leave room in the reply for the tool call. An open reasoning budget fills max_tokens and never calls the tool. */
const REASONING_BUDGET = new Map<string, string>([
	["Ministral-3-8B-Reasoning-2512", "512"],
	["Qwen3.5-9B", "512"],
	["LFM2.5-8B-A1B", "512"],
]);

/** Real server only when TREK_LLAMA_SERVER and TREK_MODELS_DIR are set. Otherwise ensure() throws before spawn. */
export function llamaServerArgs(request: SpawnRequest): string[] {
	const args = ["--host", "127.0.0.1", "--port", String(request.port), "--jinja"];
	if (toolDialect(request.modelId) === "lfm") {
		args.push("--chat-template-file", lfmChatTemplatePath());
	}
	args.push("-m", resolveWeightPath(request.modelId), "-c", String(localContextWindow(request.modelId)));
	const budget = REASONING_BUDGET.get(request.modelId);
	if (budget) {
		args.push("--reasoning-budget", budget);
	}
	const ngl = process.env.TREK_LLAMA_NGL?.trim();
	if (ngl) {
		args.push("-ngl", ngl);
	}
	return args;
}

/** llama.cpp, or MLX when this Mac has the 4-bit snapshot and mlx_lm.server. */
export function localServerCommand(request: SpawnRequest): { command: string; args: string[] } {
	if (useMlx(request.modelId)) {
		ensureMlxChatTemplate(request.modelId);
		const command = mlxServerBin();
		if (!command) {
			throw new Error("mlx_lm.server is not installed.");
		}
		return { command, args: mlxServerArgs(request.modelId, request.port) };
	}
	const command = process.env.TREK_LLAMA_SERVER;
	if (!command) {
		throw new Error("llama-server binary not found.");
	}
	return { command, args: llamaServerArgs(request) };
}

export function createDefaultLlamaProcessManager(): LlamaProcessManager {
	return new LlamaProcessManager({
		spawn: (request) => {
			const { command, args } = localServerCommand(request);
			const logFd = openLlamaServerLog();
			const child = spawn(command, args, {
				stdio: logFd === undefined ? "ignore" : ["ignore", "ignore", logFd],
			});
			if (logFd !== undefined) {
				closeSync(logFd);
			}
			if (!child.pid) {
				throw new Error("llama-server did not start.");
			}
			// The server must not keep `trek --print` alive after the prompt returns.
			child.unref();
			try {
				waitForLocalServer({ port: request.port, modelId: request.modelId });
			} catch (error) {
				try {
					child.kill("SIGTERM");
				} catch {
					// The process is already gone.
				}
				throw error;
			}
			return { pid: child.pid };
		},
		allocatePort: createPortAllocator(portStart()),
		binaryAvailable: () => {
			const binary = process.env.TREK_LLAMA_SERVER;
			const llama = typeof binary === "string" && binary.length > 0 && existsSync(binary);
			return llama || (preferMlx() && Boolean(mlxServerBin()));
		},
		weightsAvailable: (_role, modelId) => weightFileExists(modelId) || useMlx(modelId),
	});
}
