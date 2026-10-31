/**
 * Ask before fetching a missing local GGUF. A decline leaves the file absent.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { weightFileExists } from "./process-manager.ts";
import type { ResolvedRuntime } from "./resolve.ts";
import { SESSION_LOCAL_ROLES } from "./types.ts";

export interface WeightSource {
	repo: string;
	file: string;
}

/** Chat GGUFs the local suites spawn. Encoders such as ColBERT are not in this list. */
export const WEIGHT_SOURCES: Record<string, WeightSource> = {
	"Qwen3.5-0.8B": { repo: "unsloth/Qwen3.5-0.8B-GGUF", file: "Qwen3.5-0.8B-Q4_K_M.gguf" },
	"Ministral-3-3B-Instruct-2512": {
		repo: "unsloth/Ministral-3-3B-Instruct-2512-GGUF",
		file: "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf",
	},
	"Ministral-3-8B-Reasoning-2512": {
		repo: "unsloth/Ministral-3-8B-Reasoning-2512-GGUF",
		file: "Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",
	},
	"Devstral-Small-2507": { repo: "unsloth/Devstral-Small-2507-GGUF", file: "Devstral-Small-2507-Q4_K_M.gguf" },
	"Qwen3.5-4B": { repo: "unsloth/Qwen3.5-4B-GGUF", file: "Qwen3.5-4B-Q4_K_M.gguf" },
	"Qwen3.5-9B": { repo: "unsloth/Qwen3.5-9B-GGUF", file: "Qwen3.5-9B-Q4_K_M.gguf" },
	"LFM2.5-350M": { repo: "LiquidAI/LFM2.5-350M-GGUF", file: "LFM2.5-350M-Q4_K_M.gguf" },
	"LFM2.5-1.2B-Instruct": {
		repo: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
		file: "LFM2.5-1.2B-Instruct-Q4_K_M.gguf",
	},
	"LFM2.5-8B-A1B": { repo: "LiquidAI/LFM2.5-8B-A1B-GGUF", file: "LFM2.5-8B-A1B-Q4_K_M.gguf" },
};

export interface MissingWeight {
	role: string;
	id: string;
	repo: string;
	file: string;
}

export function modelsDir(dir = process.env.TREK_MODELS_DIR): string {
	return dir && dir.length > 0 ? dir : join(homedir(), ".trek", "models");
}

export function missingLocalWeights(resolved: ResolvedRuntime, dir = modelsDir()): MissingWeight[] {
	if (resolved.effectiveMode === "api") {
		return [];
	}
	const missing: MissingWeight[] = [];
	for (const role of SESSION_LOCAL_ROLES) {
		const assignment = resolved.roles[role];
		if (!assignment || assignment.source !== "local") {
			continue;
		}
		if (weightFileExists(assignment.id, dir)) {
			continue;
		}
		const source = WEIGHT_SOURCES[assignment.id];
		if (!source) {
			continue;
		}
		missing.push({ role, id: assignment.id, repo: source.repo, file: source.file });
	}
	return missing;
}

export function missingWeightQuestion(missing: readonly MissingWeight[]): string {
	const names = missing.map((item) => `${item.role} ${item.id}`).join(", ");
	return `Download missing models: ${names}?`;
}

export async function offerMissingWeights(input: {
	resolved: ResolvedRuntime;
	confirm: (message: string) => Promise<boolean>;
	download: (item: MissingWeight, dir: string) => Promise<void>;
	dir?: string;
	interactive?: boolean;
}): Promise<"none" | "declined" | "downloaded"> {
	const dir = input.dir ?? modelsDir();
	const missing = missingLocalWeights(input.resolved, dir);
	if (missing.length === 0) {
		return "none";
	}
	if (input.interactive === false) {
		return "declined";
	}
	const accepted = await input.confirm(missingWeightQuestion(missing));
	if (!accepted) {
		return "declined";
	}
	for (const item of missing) {
		await input.download(item, dir);
	}
	return "downloaded";
}

function isGguf(path: string): boolean {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(4);
		const read = readSync(fd, buffer, 0, 4, 0);
		return read === 4 && buffer.toString("utf8") === "GGUF";
	} finally {
		closeSync(fd);
	}
}

export function downloadWeight(item: MissingWeight, dir = modelsDir()): Promise<void> {
	const stage = join(dir, ".src", item.id);
	mkdirSync(stage, { recursive: true });
	return new Promise((resolve, reject) => {
		const child = spawn("hf", ["download", item.repo, item.file, "--local-dir", stage], {
			stdio: "inherit",
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			reject(error.code === "ENOENT" ? new Error("hf is required to download models.") : error);
		});
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`hf download ${item.id} exited ${code ?? "unknown"}.`));
				return;
			}
			const filePath = join(stage, item.file);
			if (!isGguf(filePath)) {
				reject(new Error(`downloaded file is not a GGUF: ${filePath}`));
				return;
			}
			const dest = join(dir, `${item.id}.gguf`);
			if (existsSync(dest)) {
				unlinkSync(dest);
			}
			symlinkSync(join(".src", item.id, item.file), dest);
			resolve();
		});
	});
}
