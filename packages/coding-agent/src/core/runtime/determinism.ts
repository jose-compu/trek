/**
 * Which local GGUFs can honor the session seed.
 * llama-server receives `seed`. Sampling is then fixed only when the logits match.
 * The default Apple build offloads to the GPU, and that path is not bit-exact.
 * TREK_LLAMA_NGL=0 forces CPU (`-ngl 0`), which is the audit path for dense models.
 * LFM2.5-8B-A1B is a mixture of experts and stays best-effort on CPU as well.
 * Encoders are not chat models and are not eligible for strict_audit.
 */

import type { DeterminismSupport } from "../reproducibility/types.ts";

const DENSE_CHAT = [
	"Qwen3.5-0.8B",
	"Ministral-3-3B-Instruct-2512",
	"Ministral-3-8B-Reasoning-2512",
	"Devstral-Small-2507",
	"Qwen3.5-4B",
	"Qwen3.5-9B",
	"LFM2.5-350M",
	"LFM2.5-1.2B-Instruct",
] as const;

const MOE_CHAT = ["LFM2.5-8B-A1B"] as const;

const ENCODERS = [
	"sentence-transformers/all-MiniLM-L6-v2",
	"cross-encoder/ms-marco-MiniLM-L-6-v2",
	"Qwen3-Embedding-0.6B",
	"Qwen3-Reranker-0.6B",
	"LFM2-ColBERT-350M",
] as const;

export type LocalModelKind = "dense" | "moe" | "encoder" | "unknown";

export interface LocalModelDeterminism {
	id: string;
	kind: LocalModelKind;
	support: DeterminismSupport;
	notes: string;
}

export function localLlamaUsesCpu(): boolean {
	return process.env.TREK_LLAMA_NGL?.trim() === "0";
}

export function matchLocalModelId(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined;
	}
	const text = raw.trim();
	const base =
		text
			.split(/[/\\]/)
			.pop()
			?.replace(/\.gguf$/i, "") ?? text;
	const quantStripped = base.replace(/-(?:Q\d|IQ\d|F16|F32|BF16).*$/i, "");
	for (const id of [...DENSE_CHAT, ...MOE_CHAT, ...ENCODERS]) {
		if (
			text === id ||
			base === id ||
			quantStripped === id ||
			text.endsWith(`/${id}`) ||
			text.endsWith(`/${id}.gguf`)
		) {
			return id;
		}
	}
	return undefined;
}

export function localModelKind(modelId: string | undefined): LocalModelKind {
	const id = matchLocalModelId(modelId);
	if (!id) {
		return "unknown";
	}
	if ((MOE_CHAT as readonly string[]).includes(id)) {
		return "moe";
	}
	if ((ENCODERS as readonly string[]).includes(id)) {
		return "encoder";
	}
	if ((DENSE_CHAT as readonly string[]).includes(id)) {
		return "dense";
	}
	return "unknown";
}

export function localModelDeterminism(modelId: string | undefined, cpu = localLlamaUsesCpu()): LocalModelDeterminism {
	const id = matchLocalModelId(modelId) ?? (modelId?.trim() || "unknown");
	const kind = localModelKind(modelId);
	if (kind === "encoder") {
		return {
			id,
			kind,
			support: "unsupported",
			notes: "Encoder. It is not a chat model and is not eligible for strict_audit.",
		};
	}
	if (kind === "moe") {
		return {
			id,
			kind,
			support: "best-effort",
			notes: "Mixture-of-experts. The session seed is sent. Expert routing is not bit-exact on GPU or with TREK_LLAMA_NGL=0.",
		};
	}
	if (kind === "dense" && cpu) {
		return {
			id,
			kind,
			support: "seed",
			notes: "Dense model on CPU (TREK_LLAMA_NGL=0). llama-server receives the session seed. Keep temperature at 0.",
		};
	}
	if (kind === "dense") {
		return {
			id,
			kind,
			support: "best-effort",
			notes: "Dense model. The session seed is sent. Default llama-server uses the GPU, which is not bit-exact. Set TREK_LLAMA_NGL=0 for CPU replay.",
		};
	}
	return {
		id,
		kind,
		support: "best-effort",
		notes: "Unlisted local model. The session seed is sent. Do not assume bit-exact replay.",
	};
}

export function formatLocalDeterminismTable(): string {
	const lines = [
		"Local model determinism (llama-server seed):",
		"  GPU is the default. TREK_LLAMA_NGL=0 is the CPU audit path. Temperature 0 is required.",
	];
	for (const id of DENSE_CHAT) {
		lines.push(`  ${id.padEnd(36)} dense   GPU best-effort   CPU seed honored`);
	}
	for (const id of MOE_CHAT) {
		lines.push(`  ${id.padEnd(36)} moe     GPU best-effort   CPU best-effort`);
	}
	lines.push("  Encoders are not chat models and are not eligible for strict_audit:");
	for (const id of ENCODERS) {
		lines.push(`  ${id.padEnd(36)} encoder no seed`);
	}
	return lines.join("\n");
}
