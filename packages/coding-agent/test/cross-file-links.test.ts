/**
 * Tests for cross-file links (#221).
 */

import { describe, expect, it } from "vitest";
import { generateCrossFileLinks } from "../src/core/memory/cross-file-links.ts";

describe("cross-file links", () => {
	it("extracts TypeScript import links", () => {
		const code = `
import { foo } from "some-module";
import bar from "another-module";
const baz = require("third-module");
`;
		const links = generateCrossFileLinks(code, "test.ts", "unknown");

		expect(links).toContainEqual({ targetPath: "some-module", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "another-module", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "third-module", linkType: "import" });
	});

	it("extracts Python import links", () => {
		const code = `
import numpy
from pandas import DataFrame
import matplotlib.pyplot as plt
`;
		const links = generateCrossFileLinks(code, "test.py", "unknown");

		expect(links).toContainEqual({ targetPath: "numpy", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "pandas", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "matplotlib.pyplot", linkType: "import" });
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

	it("extracts module from doc heading", () => {
		const heading = "# MyModule API";
		const links = generateCrossFileLinks(heading, "docs/api.md", "heading");

		const moduleLinks = links.filter((l) => l.linkType === "doc-module");
		expect(moduleLinks.length).toBeGreaterThan(0);
		expect(moduleLinks.some((l) => l.targetPath.includes("MyModule"))).toBe(true);
	});

	it("does not link non-heading markdown chunks", () => {
		const text = "This is just regular text about SomeModule.";
		const links = generateCrossFileLinks(text, "docs/guide.md", "section");

		const moduleLinks = links.filter((l) => l.linkType === "doc-module");
		expect(moduleLinks.length).toBe(0);
	});

	it("handles files with no imports", () => {
		const code = `const x = 42;\nconsole.log(x);`;
		const links = generateCrossFileLinks(code, "simple.js", "unknown");

		const importLinks = links.filter((l) => l.linkType === "import");
		expect(importLinks.length).toBe(0);
		// Should still have test pair link
		expect(links).toContainEqual({ targetPath: "simple.test.js", linkType: "test-pair" });
	});

	it("extracts Go imports", () => {
		const code = `
package main

import (
	"fmt"
	"os"
)
import "strings"
`;
		const links = generateCrossFileLinks(code, "main.go", "unknown");

		expect(links).toContainEqual({ targetPath: "fmt", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "os", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "strings", linkType: "import" });
	});

	it("extracts Rust use statements", () => {
		const code = `
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
`;
		const links = generateCrossFileLinks(code, "lib.rs", "unknown");

		expect(links).toContainEqual({ targetPath: "std::collections::HashMap", linkType: "import" });
		expect(links).toContainEqual({ targetPath: "serde::{Serialize, Deserialize}", linkType: "import" });
	});

	it("handles spec test files", () => {
		const code = `describe("foo", () => { /* ... */ });`;
		const links = generateCrossFileLinks(code, "foo.spec.ts", "unknown");

		expect(links).toContainEqual({ targetPath: "foo.ts", linkType: "test-pair" });
	});
});
