/**
 * Embeddings for local memory.
 * Tests and CI use the bag-of-words embedder. Production loads MiniLM on first use
 * only when local weights are requested (`local` / `hybrid`, or `TREK_MEMORY_LOCAL=1`).
 * API mode does not load ONNX. Downloads are opt-in (`TREK_MEMORY_DOWNLOAD=1`).
 */

import type { HierarchyMode } from "../runtime/types.ts";

export interface Embedder {
	dim: number;
	embed(text: string): Promise<number[]>;
}

export interface MemoryModelOptions {
	mode?: HierarchyMode;
}

export function normalizeL2(values: number[]): number[] {
	let sum = 0;
	for (const value of values) sum += value * value;
	const norm = Math.sqrt(sum);
	if (norm === 0) return values.map(() => 0);
	return values.map((value) => value / norm);
}

/** Deterministic small vectors. Overlapping words land near each other. */
export function fakeEmbedder(dim = 32): Embedder & { calls: string[] } {
	const calls: string[] = [];
	return {
		dim,
		calls,
		async embed(text: string) {
			calls.push(text);
			return bagOfWords(text, dim);
		},
	};
}

export function bagOfWords(text: string, dim: number): number[] {
	const vector = new Array<number>(dim).fill(0);
	for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
		if (!token) continue;
		let hash = 0;
		for (let i = 0; i < token.length; i++) hash = (hash * 33 + token.charCodeAt(i)) >>> 0;
		vector[hash % dim] += 1;
	}
	return normalizeL2(vector);
}

const MINILM = "Xenova/all-MiniLM-L6-v2";
const MINILM_DIM = 384;

export function useFakeEmbedder(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.VITEST === "true" || env.TREK_MEMORY_EMBEDDER === "fake";
}

/** Keep 384-d so an existing MiniLM store is not opened as a different namespace. */
export function noopEmbedder(dim = MINILM_DIM): Embedder {
	return {
		dim,
		async embed() {
			return [];
		},
	};
}

/** ONNX MiniLM: local/hybrid, or API when `TREK_MEMORY_LOCAL=1`. */
export function shouldLoadMemoryOnnx(env: NodeJS.ProcessEnv = process.env, mode?: HierarchyMode): boolean {
	if (env.TREK_MEMORY_LOCAL === "0") return false;
	if (env.TREK_MEMORY_LOCAL === "1") return true;
	return mode === "local" || mode === "hybrid";
}

function allowMemoryDownload(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TREK_MEMORY_DOWNLOAD === "1";
}

/** Lazy MiniLM. A failed load embeds nothing and recall stays empty. */
export function createEmbedder(env: NodeJS.ProcessEnv = process.env, options: MemoryModelOptions = {}): Embedder {
	if (useFakeEmbedder(env)) return fakeEmbedder();
	if (!shouldLoadMemoryOnnx(env, options.mode)) return noopEmbedder();
	return lazyMiniLm(allowMemoryDownload(env));
}

function lazyMiniLm(allowDownload: boolean): Embedder {
	let failed = false;
	let extractor:
		| ((text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>)
		| undefined;
	return {
		dim: MINILM_DIM,
		async embed(text: string) {
			if (failed) return [];
			try {
				if (!extractor) {
					const transformers = (await import("@xenova/transformers")) as {
						pipeline: (
							task: string,
							model: string,
							opts?: { local_files_only?: boolean },
						) => Promise<
							(
								text: string,
								opts: { pooling: string; normalize: boolean },
							) => Promise<{ data: ArrayLike<number> }>
						>;
					};
					extractor = await transformers.pipeline("feature-extraction", MINILM, {
						local_files_only: !allowDownload,
					});
				}
				const output = await extractor(text, { pooling: "mean", normalize: true });
				return Array.from(output.data);
			} catch {
				failed = true;
				return [];
			}
		},
	};
}
