/**
 * Embeddings for local memory.
 * Tests and CI use the bag-of-words embedder. Production prefers ONNX MiniLM in every
 * hierarchy mode (including API chat) so lessons stay semantic. Weights load lazily;
 * if MiniLM is missing or fails, bag-of-words at 384-d stores and recalls. Opt out with
 * `TREK_MEMORY_LOCAL=0`. Downloads are opt-in (`TREK_MEMORY_DOWNLOAD=1`).
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

/** Lexical 384-d vectors. Used when ONNX MiniLM is off or failed to load. */
export function lexicalEmbedder(dim = MINILM_DIM): Embedder {
	return fakeEmbedder(dim);
}

/**
 * Prefer ONNX MiniLM in every mode (API chat included).
 * `TREK_MEMORY_LOCAL=0` skips ONNX. `TREK_MEMORY_LOCAL=1` keeps the explicit opt-in.
 */
export function shouldLoadMemoryOnnx(env: NodeJS.ProcessEnv = process.env, _mode?: HierarchyMode): boolean {
	if (env.TREK_MEMORY_LOCAL === "0") return false;
	return true;
}

function allowMemoryDownload(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TREK_MEMORY_DOWNLOAD === "1";
}

/**
 * Prefer MiniLM when ONNX is allowed. Otherwise bag-of-words.
 * `TREK_MEMORY_EMBEDDER=off` keeps the empty no-op for operators who want indexing off.
 */
export function createEmbedder(env: NodeJS.ProcessEnv = process.env, options: MemoryModelOptions = {}): Embedder {
	if (useFakeEmbedder(env)) return fakeEmbedder();
	if (env.TREK_MEMORY_EMBEDDER === "off") return noopEmbedder();
	if (!shouldLoadMemoryOnnx(env, options.mode)) return lexicalEmbedder();
	return lazyMiniLm(allowMemoryDownload(env));
}

function lazyMiniLm(allowDownload: boolean): Embedder {
	let failed = false;
	const fallback = lexicalEmbedder();
	let extractor:
		| ((text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>)
		| undefined;
	return {
		dim: MINILM_DIM,
		async embed(text: string) {
			if (failed) return fallback.embed(text);
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
				return fallback.embed(text);
			}
		},
	};
}
