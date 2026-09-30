/**
 * One llama-server process per role (PROMPT §19, issue #88).
 * Spawn is injected so CI never starts a real server.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ResolvedRuntime } from "./resolve.ts";
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

/** Real server only when TREK_LLAMA_SERVER and TREK_MODELS_DIR are set. Otherwise ensure() throws before spawn. */
export function createDefaultLlamaProcessManager(): LlamaProcessManager {
	return new LlamaProcessManager({
		spawn: (request) => {
			const binary = process.env.TREK_LLAMA_SERVER;
			if (!binary) {
				throw new Error("llama-server binary not found.");
			}
			// --jinja keeps the GGUF chat template, including tool calls. Without it, tool_choice is ignored.
			const args = [
				"--host",
				"127.0.0.1",
				"--port",
				String(request.port),
				"--jinja",
				"-m",
				resolveWeightPath(request.modelId),
			];
			const ctx = process.env.TREK_LLAMA_CTX?.trim();
			if (ctx) {
				args.push("-c", ctx);
			}
			const ngl = process.env.TREK_LLAMA_NGL?.trim();
			if (ngl) {
				args.push("-ngl", ngl);
			}
			const logFd = openLlamaServerLog();
			const child = spawn(binary, args, {
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
			return { pid: child.pid };
		},
		allocatePort: createPortAllocator(portStart()),
		binaryAvailable: () => {
			const binary = process.env.TREK_LLAMA_SERVER;
			return typeof binary === "string" && binary.length > 0 && existsSync(binary);
		},
		weightsAvailable: (_role, modelId) => weightFileExists(modelId),
	});
}
