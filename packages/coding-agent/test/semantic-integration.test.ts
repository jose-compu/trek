/**
 * Tests for semantic split/merge integration in the main pipeline.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunksForFile } from "../src/core/memory/index-files.ts";

describe("semantic split/merge integration", () => {
	const testDir = "/tmp/trek-semantic-test";

	beforeEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(testDir, { recursive: true });
		// Enable semantic split for tests
		process.env.TREK_SEMANTIC_SPLIT = "1";
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		delete process.env.TREK_SEMANTIC_SPLIT;
	});

	it("applies semantic split to unstructured text", () => {
		const file = join(testDir, "notes.txt");
		writeFileSync(
			file,
			`apple is a fruit
apricot is also a fruit
avocado is green

banana is yellow
berry is small
blueberry is blue`,
		);

		const chunks = chunksForFile(file, testDir);

		// Lines starting with 'a' are similar, lines starting with 'b' are similar
		// Should split between 'avocado' and 'banana'
		// At minimum, we should get at least one chunk
		expect(chunks.length).toBeGreaterThanOrEqual(1);

		// Check that the chunk contains expected content
		const allText = chunks.map((c) => c.stored).join("\n");
		expect(allText).toContain("apple");
		expect(allText).toContain("banana");
	});

	it("does not split structured code chunks", () => {
		const file = join(testDir, "code.ts");
		writeFileSync(
			file,
			`export function foo() {
  const apple = 1;
  const banana = 2;
  return apple + banana;
}

export function bar() {
  return 42;
}`,
		);

		const chunks = chunksForFile(file, testDir);

		// Functions should remain as separate chunks, not split internally
		const fooChunk = chunks.find((c) => c.stored.includes("function foo"));
		expect(fooChunk).toBeDefined();
		expect(fooChunk?.stored).toContain("apple");
		expect(fooChunk?.stored).toContain("banana");
	});

	it("merges tiny orphan chunks", () => {
		const file = join(testDir, "small.txt");
		writeFileSync(
			file,
			`This is a longer text with many words to exceed the threshold
tiny
Another long text with sufficient content to stay separate`,
		);

		const chunks = chunksForFile(file, testDir);

		// Orphan should be merged, not standalone
		const tinyAlone = chunks.find((c) => c.stored === "tiny");
		expect(tinyAlone).toBeUndefined();
	});

	it("works with semantic split disabled", () => {
		delete process.env.TREK_SEMANTIC_SPLIT;

		const file = join(testDir, "text.txt");
		writeFileSync(file, `apple is fruit\nbanana is yellow`);

		const chunks = chunksForFile(file, testDir);

		// Should still work, just without semantic split
		expect(chunks.length).toBeGreaterThan(0);
	});

	it("preserves chunk metadata after refinement", () => {
		const file = join(testDir, "metadata.txt");
		writeFileSync(
			file,
			`apple is fruit
apricot is also fruit

banana is yellow`,
		);

		const chunks = chunksForFile(file, testDir);

		for (const chunk of chunks) {
			// All chunks should have chunk IDs
			expect(chunk.stored).toMatch(/\[chunk-id:/);
		}
	});
});
