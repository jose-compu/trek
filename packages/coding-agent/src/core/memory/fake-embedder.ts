/**
 * Fake embedder for testing semantic split/merge in the pipeline.
 */

import type { Embedder } from "./semantic-split-merge.ts";

/**
 * Simple fake embedder that treats lines starting with same letter as similar.
 * Used only for testing.
 */
export class FakeEmbedder implements Embedder {
	embed(text: string): number[] {
		const firstChar = text.trim()[0]?.toLowerCase() || "x";
		const code = firstChar.charCodeAt(0) - 97; // a=0, b=1, ...
		const vector = new Array(10).fill(0);
		vector[code % 10] = 1.0;
		return vector;
	}
}

/**
 * Get an embedder instance. In production, this would use a real embedding model.
 * For now, returns null to disable semantic split/merge.
 */
export function getEmbedder(): Embedder | null {
	// Disabled by default in production
	// Enable for testing with TREK_SEMANTIC_SPLIT=1
	if (process.env.TREK_SEMANTIC_SPLIT === "1") {
		return new FakeEmbedder();
	}
	return null;
}
