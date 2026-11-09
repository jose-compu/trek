/**
 * Tests for semantic split and merge (#219).
 */

import { describe, expect, it } from "vitest";
import { type Embedder, mergeOrphans, semanticSplit } from "../src/core/memory/semantic-split-merge.ts";

/**
 * Fake embedder with controllable similarity.
 * Lines starting with same letter get similar embeddings.
 */
class FakeEmbedder implements Embedder {
	embed(text: string): number[] {
		const firstChar = text.trim()[0]?.toLowerCase() || "x";
		const code = firstChar.charCodeAt(0) - 97; // a=0, b=1, ...
		const vector = new Array(10).fill(0);
		vector[code % 10] = 1.0;
		return vector;
	}
}

describe("semantic split and merge", () => {
	const embedder = new FakeEmbedder();

	it("splits at topic boundaries", () => {
		const chunk = {
			text: `apple are fruits
apricots are also fruits
banana is yellow
berries are small`,
			lineStart: 1,
			lineEnd: 4,
		};

		const result = semanticSplit(chunk, embedder, 0.5);

		// Lines starting with 'a' are similar, lines starting with 'b' are similar
		// Should split between 'apricots' and 'banana'
		expect(result.length).toBeGreaterThan(1);
		expect(result[0]?.text).toContain("apple");
		expect(result[0]?.text).toContain("apricots");
	});

	it("does not split when similarity is high", () => {
		const chunk = {
			text: `apple is red
apricots are orange
avocado is green`,
			lineStart: 1,
			lineEnd: 3,
		};

		const result = semanticSplit(chunk, embedder, 0.5);

		// All lines start with 'a', so they should not split
		expect(result.length).toBe(1);
	});

	it("merges orphan chunks under token threshold", () => {
		const chunks = [
			{ text: "This is a longer chunk with many words to exceed the threshold easily" },
			{ text: "tiny" }, // Orphan
			{ text: "Another longer chunk with sufficient words to be kept separate from others" },
		];

		const result = mergeOrphans(chunks, 10);

		// Orphan should be merged
		expect(result.length).toBe(2);
	});

	it("does not merge chunks above threshold", () => {
		const chunks = [
			{ text: "First chunk with enough words to stay separate" },
			{ text: "Second chunk also has enough words to remain independent" },
			{ text: "Third chunk is sufficiently long as well" },
		];

		const result = mergeOrphans(chunks, 5);

		expect(result.length).toBe(3);
	});

	it("merges last orphan with previous", () => {
		const chunks = [{ text: "First chunk with many words to be above the minimum threshold" }, { text: "tiny" }];

		const result = mergeOrphans(chunks, 10);

		expect(result.length).toBe(1);
		expect(result[0]?.text).toContain("First chunk");
		expect(result[0]?.text).toContain("tiny");
	});

	it("merges first orphan with next", () => {
		const chunks = [{ text: "tiny" }, { text: "Second chunk has many words to exceed the minimum token threshold" }];

		const result = mergeOrphans(chunks, 10);

		expect(result.length).toBe(1);
		expect(result[0]?.text).toContain("tiny");
		expect(result[0]?.text).toContain("Second chunk");
	});

	it("merges middle orphan with smaller neighbor", () => {
		const chunks = [
			{ text: "First chunk is medium size with some words" },
			{ text: "tiny" },
			{ text: "Third chunk is very long with many words and should be larger than first" },
		];

		const result = mergeOrphans(chunks, 10);

		expect(result.length).toBe(2);
		// Orphan should merge with first (smaller)
		expect(result[0]?.text).toContain("tiny");
	});

	it("handles single chunk", () => {
		const chunks = [{ text: "Only one chunk here" }];
		const result = mergeOrphans(chunks, 10);
		expect(result).toEqual(chunks);
	});

	it("handles empty chunks", () => {
		const result = mergeOrphans([], 10);
		expect(result).toEqual([]);
	});

	it("semantic split handles single line", () => {
		const chunk = { text: "single line" };
		const result = semanticSplit(chunk, embedder, 0.5);
		expect(result).toEqual([chunk]);
	});

	it("combines split and merge for complete workflow", () => {
		const chunk = {
			text: `apple is fruit
apricot is also fruit
}
banana is yellow
berry is small`,
		};

		// Split at topic boundaries
		const split = semanticSplit(chunk, embedder, 0.5);

		// The closing brace line will likely be an orphan
		const merged = mergeOrphans(split, 5);

		// Should have fewer chunks than split, and no tiny orphans
		expect(merged.length).toBeGreaterThan(0);
		for (const chunk of merged) {
			const tokens = chunk.text.trim().split(/\s+/).length;
			expect(tokens).toBeGreaterThan(1);
		}
	});
});
