/**
 * One llama-server process per role (PROMPT §19, issue #88).
 * Spawn is injected so CI never starts a real server.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedRuntime } from "./resolve.ts";
import { isLocalServerRole, type LocalServerRole } from "./types.ts";

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
}

export function createPortAllocator(start = 18080): () => number {
	let next = start;
	return () => next++;
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

	list(): LlamaServerHandle[] {
		return [...this.handles.values()];
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
			const child = spawn(binary, ["--port", String(request.port), "-m", request.modelId], {
				stdio: "ignore",
			});
			if (!child.pid) {
				throw new Error("llama-server did not start.");
			}
			return { pid: child.pid };
		},
		allocatePort: createPortAllocator(),
		binaryAvailable: () => {
			const binary = process.env.TREK_LLAMA_SERVER;
			return typeof binary === "string" && binary.length > 0 && existsSync(binary);
		},
		weightsAvailable: (_role, modelId) => {
			const dir = process.env.TREK_MODELS_DIR;
			if (!dir) {
				return false;
			}
			return existsSync(join(dir, modelId)) || existsSync(join(dir, `${modelId}.gguf`));
		},
	});
}
