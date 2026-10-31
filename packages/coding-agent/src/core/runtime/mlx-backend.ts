/**
 * MLX on Apple Silicon. The 4-bit snapshot uses Metal directly.
 * A missing snapshot or TREK_MLX=0 keeps the GGUF on llama.cpp.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LFM_CHAT_TEMPLATE } from "./lfm-chat-template.ts";
import type { ResolvedRuntime } from "./resolve.ts";
import { SESSION_LOCAL_ROLES } from "./types.ts";

export const MLX_SOURCES: Record<string, { repo: string }> = {
	"LFM2.5-350M": { repo: "LiquidAI/LFM2.5-350M-MLX-4bit" },
	"LFM2.5-1.2B-Instruct": { repo: "LiquidAI/LFM2.5-1.2B-Instruct-MLX-4bit" },
	"LFM2.5-8B-A1B": { repo: "LiquidAI/LFM2.5-8B-A1B-MLX-4bit" },
	"Qwen3.5-0.8B": { repo: "mlx-community/Qwen3.5-0.8B-MLX-4bit" },
	"Qwen3.5-4B": { repo: "mlx-community/Qwen3.5-4B-MLX-4bit" },
	"Qwen3.5-9B": { repo: "mlx-community/Qwen3.5-9B-4bit" },
	"Ministral-3-3B-Instruct-2512": { repo: "mlx-community/Ministral-3-3B-Instruct-2512-4bit" },
	"Devstral-Small-2507": { repo: "mlx-community/Devstral-Small-2507-4bit" },
};

export function preferMlx(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.TREK_MLX === "0") {
		return false;
	}
	if (env.TREK_MLX === "1") {
		return true;
	}
	return process.platform === "darwin" && process.arch === "arm64";
}

function modelsRoot(env: NodeJS.ProcessEnv): string {
	const dir = env.TREK_MODELS_DIR?.trim();
	return dir && dir.length > 0 ? dir : join(homedir(), ".trek", "models");
}

export function mlxModelDir(modelId: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(modelsRoot(env), "mlx", modelId);
}

export function mlxWeightExists(modelId: string, env: NodeJS.ProcessEnv = process.env): boolean {
	return existsSync(join(mlxModelDir(modelId, env), "config.json"));
}

/** ~/.trek/mlx/bin/mlx_lm.server, or TREK_MLX_SERVER. */
export function mlxServerBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const set = env.TREK_MLX_SERVER?.trim();
	if (set && existsSync(set)) {
		return set;
	}
	const bundled = join(homedir(), ".trek", "mlx", "bin", "mlx_lm.server");
	return existsSync(bundled) ? bundled : undefined;
}

/**
 * mlx_lm 0.32 does not honor tool_choice. The 1.2B then describes the call.
 * The 8B planning snapshot returns a parsed write call, so only that id switches.
 */
const MLX_TOOL_READY = new Set(["LFM2.5-8B-A1B"]);

export function useMlx(modelId: string, env: NodeJS.ProcessEnv = process.env): boolean {
	return preferMlx(env) && MLX_TOOL_READY.has(modelId) && mlxWeightExists(modelId, env) && Boolean(mlxServerBin(env));
}

/** The snapshot's own template only lists tools as JSON. Liquid's dialect has to be on disk. */
export function ensureMlxChatTemplate(modelId: string, env: NodeJS.ProcessEnv = process.env): void {
	if (!modelId.startsWith("LFM2.5")) {
		return;
	}
	const dir = mlxModelDir(modelId, env);
	if (!existsSync(join(dir, "config.json"))) {
		return;
	}
	const path = join(dir, "chat_template.jinja");
	const current = existsSync(path) ? readFileSync(path, "utf8") : "";
	if (current.includes("<|tool_call_start|>") && current.includes("Call a tool as")) {
		return;
	}
	writeFileSync(path, LFM_CHAT_TEMPLATE);
}

export function mlxServerArgs(modelId: string, port: number, env: NodeJS.ProcessEnv = process.env): string[] {
	return ["--model", mlxModelDir(modelId, env), "--host", "127.0.0.1", "--port", String(port)];
}

export interface MissingMlxWeight {
	role: string;
	id: string;
	repo: string;
}

export function missingMlxWeights(resolved: ResolvedRuntime, env: NodeJS.ProcessEnv = process.env): MissingMlxWeight[] {
	if (!preferMlx(env) || resolved.effectiveMode === "api") {
		return [];
	}
	const missing: MissingMlxWeight[] = [];
	for (const role of SESSION_LOCAL_ROLES) {
		const assignment = resolved.roles[role];
		if (!assignment || assignment.source !== "local") {
			continue;
		}
		const source = MLX_SOURCES[assignment.id];
		if (!source || mlxWeightExists(assignment.id, env)) {
			continue;
		}
		missing.push({ role, id: assignment.id, repo: source.repo });
	}
	return missing;
}

export function missingMlxQuestion(missing: readonly MissingMlxWeight[]): string {
	const names = missing.map((item) => `${item.role} ${item.id}`).join(", ");
	return `Download MLX weights for this Mac: ${names}?`;
}

export async function offerMissingMlx(input: {
	resolved: ResolvedRuntime;
	confirm: (message: string) => Promise<boolean>;
	download: (item: MissingMlxWeight) => Promise<void>;
	env?: NodeJS.ProcessEnv;
	interactive?: boolean;
}): Promise<"none" | "declined" | "downloaded"> {
	const missing = missingMlxWeights(input.resolved, input.env ?? process.env);
	if (missing.length === 0) {
		return "none";
	}
	if (input.interactive === false) {
		return "declined";
	}
	const accepted = await input.confirm(missingMlxQuestion(missing));
	if (!accepted) {
		return "declined";
	}
	for (const item of missing) {
		await input.download(item);
	}
	return "downloaded";
}

export function downloadMlxWeight(item: MissingMlxWeight, env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const dest = mlxModelDir(item.id, env);
	mkdirSync(dest, { recursive: true });
	return new Promise((resolve, reject) => {
		const child = spawn("hf", ["download", item.repo, "--local-dir", dest], { stdio: "inherit" });
		child.on("error", (error: NodeJS.ErrnoException) => {
			reject(error.code === "ENOENT" ? new Error("hf is required to download models.") : error);
		});
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`hf download ${item.id} exited ${code ?? "unknown"}.`));
				return;
			}
			if (!existsSync(join(dest, "config.json"))) {
				reject(new Error(`MLX snapshot has no config.json: ${dest}`));
				return;
			}
			resolve();
		});
	});
}
