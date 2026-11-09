/**
 * Cross-encoder policy. Hybrid lexical fusion is separate and always local.
 * Production loads MiniLM only when local weights are requested.
 * Tests use a cheap lexical scorer.
 */

import { suitePreset } from "../runtime/suites.ts";
import type { HierarchyMode, SuiteId } from "../runtime/types.ts";
import { type MemoryModelOptions, shouldLoadMemoryOnnx, useFakeEmbedder } from "./embedder.ts";

export interface Reranker {
	/** Return a permutation of document indexes, best first. */
	rerank(query: string, documents: string[]): Promise<number[]>;
}

/** MiniLM CE in every mode unless `TREK_MEMORY_LOCAL=0`. */
export function shouldConstructCrossEncoder(input?: {
	effectiveMode: HierarchyMode;
	suite: SuiteId;
	env?: NodeJS.ProcessEnv;
}): boolean {
	if (!input) return false;
	return shouldLoadMemoryOnnx(input.env ?? process.env, input.effectiveMode);
}

/** Preferred local cross-encoder id for a suite (or the MiniLM default). */
export function suiteRerankerId(suite: SuiteId): string {
	return suitePreset(suite).roles.reranker?.id ?? "cross-encoder/ms-marco-MiniLM-L-6-v2";
}

export function useFakeReranker(env: NodeJS.ProcessEnv = process.env): boolean {
	return useFakeEmbedder(env) || env.TREK_MEMORY_RERANKER === "fake";
}

/** Lexical overlap for tests. Stable, no model download. */
export function fakeReranker(): Reranker & { calls: Array<{ query: string; documents: string[] }> } {
	const calls: Array<{ query: string; documents: string[] }> = [];
	return {
		calls,
		async rerank(query: string, documents: string[]) {
			calls.push({ query, documents });
			const tokens = new Set(
				query
					.toLowerCase()
					.split(/[^a-z0-9]+/)
					.filter(Boolean),
			);
			const scored = documents.map((document, index) => {
				const words = document
					.toLowerCase()
					.split(/[^a-z0-9]+/)
					.filter(Boolean);
				let score = 0;
				for (const word of words) {
					if (tokens.has(word)) score += 1;
				}
				return { index, score };
			});
			scored.sort((a, b) => b.score - a.score || a.index - b.index);
			return scored.map((row) => row.index);
		},
	};
}

const MINILM_CE = "Xenova/ms-marco-MiniLM-L-6-v2";

function identityReranker(): Reranker {
	return {
		async rerank(_query: string, documents: string[]) {
			return identityOrder(documents.length);
		},
	};
}

/** Lazy MiniLM cross-encoder. A failed load keeps retrieval order. */
export function createReranker(env: NodeJS.ProcessEnv = process.env, options: MemoryModelOptions = {}): Reranker {
	if (useFakeReranker(env)) return fakeReranker();
	if (!shouldLoadMemoryOnnx(env, options.mode)) return identityReranker();
	return lazyMiniLmCrossEncoder(env.TREK_MEMORY_DOWNLOAD === "1");
}

function identityOrder(n: number): number[] {
	return Array.from({ length: n }, (_, index) => index);
}

function lazyMiniLmCrossEncoder(allowDownload: boolean): Reranker {
	let failed = false;
	let classifier:
		| ((input: {
				text: string;
				text_pair: string;
		  }) => Promise<Array<{ label: string; score: number }> | { label: string; score: number }>)
		| undefined;
	return {
		async rerank(query: string, documents: string[]) {
			if (documents.length <= 1 || failed) return identityOrder(documents.length);
			try {
				if (!classifier) {
					const transformers = (await import("@xenova/transformers")) as {
						pipeline: (
							task: string,
							model: string,
							opts?: { local_files_only?: boolean },
						) => Promise<
							(input: {
								text: string;
								text_pair: string;
							}) => Promise<Array<{ label: string; score: number }> | { label: string; score: number }>
						>;
					};
					classifier = await transformers.pipeline("text-classification", MINILM_CE, {
						local_files_only: !allowDownload,
					});
				}
				const scored: Array<{ index: number; score: number }> = [];
				for (let index = 0; index < documents.length; index++) {
					const raw = await classifier({ text: query, text_pair: documents[index] ?? "" });
					const row = Array.isArray(raw) ? raw[0] : raw;
					scored.push({ index, score: typeof row?.score === "number" ? row.score : 0 });
				}
				scored.sort((a, b) => b.score - a.score || a.index - b.index);
				return scored.map((row) => row.index);
			} catch {
				failed = true;
				return identityOrder(documents.length);
			}
		},
	};
}
