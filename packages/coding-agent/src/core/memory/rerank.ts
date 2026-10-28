/**
 * Cross-encoder policy. Hybrid lexical fusion is separate and always local.
 * API mode and the LFM suite must not construct a reranker.
 */

import type { HierarchyMode, SuiteId } from "../runtime/types.ts";
import { suitePreset } from "../runtime/suites.ts";

export interface Reranker {
	/** Return a permutation of document indexes, best first. */
	rerank(query: string, documents: string[]): Promise<number[]>;
}

export function shouldConstructCrossEncoder(input: { effectiveMode: HierarchyMode; suite: SuiteId }): boolean {
	if (input.effectiveMode === "api") return false;
	return suitePreset(input.suite).rerank === true;
}
