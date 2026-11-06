import { describe, expect, test } from "vitest";
import { compactCardLines, compactViewportLines } from "../src/modes/interactive/components/compact-card.ts";

describe("compactCardLines", () => {
	test("drops a reserved blank viewport and keeps a 1-line header", () => {
		expect(compactCardLines(["", "read  notes.txt", "", ""])).toEqual(["read  notes.txt"]);
	});

	test("keeps the last 3 content lines under the header", () => {
		expect(compactCardLines(["$ npm test", "a", "b", "c", "d", "e"])).toEqual(["$ npm test", "c", "d", "e"]);
	});

	test("does not pad when content is shorter than the viewport", () => {
		expect(compactCardLines(["bash  echo hi", "hi"])).toEqual(["bash  echo hi", "hi"]);
	});

	test("error cards keep the first 3 content lines", () => {
		expect(compactCardLines(["edit  file.ts", "Could not find", "old text", "in file", "retry"], 3, "head")).toEqual([
			"edit  file.ts",
			"Could not find",
			"old text",
			"in file",
		]);
	});
});

describe("compactViewportLines", () => {
	test("returns the last 3 non-empty lines", () => {
		expect(compactViewportLines("one\n\ntwo\nthree\nfour\n")).toEqual(["two", "three", "four"]);
	});

	test("returns empty when there is no content", () => {
		expect(compactViewportLines("  \n")).toEqual([]);
	});
});
