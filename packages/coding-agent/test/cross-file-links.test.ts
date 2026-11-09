/**
 * Tests for cross-file links (#221).
 */

import { describe, expect, it } from "vitest";
import { generateCrossFileLinks, parseCrossFileLinks } from "../src/core/memory/cross-file-links.ts";

describe("cross-file links", () => {
	it("resolves relative TypeScript imports to project paths", () => {
		const code = `
import { helper } from "./helper";
import { util } from "../lib/util";
import bar from "npm-package";
`;
		const links = generateCrossFileLinks(code, "src/a.ts", "unknown");
		expect(links).toContainEqual({ targetPath: "src/helper.ts", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "lib/util.ts", linkType: "import" });
		expect(links.filter((l) => l.linkType === "import").every((l) => !l.targetPath.includes("npm-package"))).toBe(
			true,
		);
	});

	it("keeps only known paths when a set is provided", () => {
		const code = `import { helper } from "./helper";\n`;
		const known = new Set(["src/helper.ts", "src/a.ts"]);
		const links = generateCrossFileLinks(code, "src/a.ts", "unknown", known);
		expect(links).toContainEqual({ targetPath: "src/helper.ts", linkType: "import" });
		expect(links.some((l) => l.linkType === "test-pair")).toBe(false);
	});

	it("finds test pair for source file", () => {
		const code = `export function hello() { return "hi"; }`;
		const links = generateCrossFileLinks(code, "utils.ts", "unknown");
		expect(links).toContainEqual({ targetPath: "utils.test.ts", linkType: "test-pair" });
	});

	it("finds source pair for test file", () => {
		const code = `test("hello works", () => { /* ... */ });`;
		const links = generateCrossFileLinks(code, "utils.test.ts", "unknown");
		expect(links).toContainEqual({ targetPath: "utils.ts", linkType: "test-pair" });
	});

	it("extracts one doc-module candidate from a heading", () => {
		const heading = "# MyModule API";
		const known = new Set(["src/MyModule.ts"]);
		const links = generateCrossFileLinks(heading, "docs/api.md", "heading", known);
		expect(links.filter((l) => l.linkType === "doc-module")).toEqual([
			{ targetPath: "src/MyModule.ts", linkType: "doc-module" },
		]);
	});

	it("does not link non-heading markdown chunks", () => {
		const text = "This is just regular text about SomeModule.";
		const links = generateCrossFileLinks(text, "docs/guide.md", "section");
		expect(links.filter((l) => l.linkType === "doc-module")).toEqual([]);
	});

	it("parses links from a stored row", () => {
		const stored =
			'[kind:file][file:src/a.ts][lines:1-3]\nimport "./b";\n[links:[{"targetPath":"src/b.ts","linkType":"import"}]]';
		expect(parseCrossFileLinks(stored)).toEqual([{ targetPath: "src/b.ts", linkType: "import" }]);
	});

	it("handles spec test files", () => {
		const code = `describe("foo", () => { /* ... */ });`;
		const links = generateCrossFileLinks(code, "foo.spec.ts", "unknown");
		expect(links).toContainEqual({ targetPath: "foo.ts", linkType: "test-pair" });
	});
});
