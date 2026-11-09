/**
 * Tests for stable content-hash chunk IDs (#222).
 */

import { describe, expect, it } from "vitest";
import { generateHierarchy } from "../src/core/memory/hierarchy.ts";
import { chunkByStructure } from "../src/core/memory/structure-chunker.ts";

describe("stable chunk ids", () => {
	it("unchanged function keeps same ID when another function is added", () => {
		const before = `
export function unchanged() {
  return 42;
}

export function original() {
  return "original";
}
`;

		const after = `
export function unchanged() {
  return 42;
}

export function newFunction() {
  return "new";
}

export function original() {
  return "original";
}
`;

		const beforeChunks = chunkByStructure(before, { filePath: "test.ts" });
		const beforeHierarchy = generateHierarchy(beforeChunks, "test.ts");
		const unchangedBefore = beforeHierarchy.find((c) => c.signature?.includes("unchanged"));

		const afterChunks = chunkByStructure(after, { filePath: "test.ts" });
		const afterHierarchy = generateHierarchy(afterChunks, "test.ts");
		const unchangedAfter = afterHierarchy.find((c) => c.signature?.includes("unchanged"));

		expect(unchangedBefore).toBeDefined();
		expect(unchangedAfter).toBeDefined();
		expect(unchangedBefore?.chunkId).toBe(unchangedAfter?.chunkId);
	});

	it("modified function gets new ID", () => {
		const before = `
export function target() {
  return 42;
}
`;

		const after = `
export function target() {
  return 100;
}
`;

		const beforeChunks = chunkByStructure(before, { filePath: "test.ts" });
		const beforeHierarchy = generateHierarchy(beforeChunks, "test.ts");
		const targetBefore = beforeHierarchy.find((c) => c.signature?.includes("target"));

		const afterChunks = chunkByStructure(after, { filePath: "test.ts" });
		const afterHierarchy = generateHierarchy(afterChunks, "test.ts");
		const targetAfter = afterHierarchy.find((c) => c.signature?.includes("target"));

		expect(targetBefore).toBeDefined();
		expect(targetAfter).toBeDefined();
		expect(targetBefore?.chunkId).not.toBe(targetAfter?.chunkId);
	});

	it("chunk IDs are deterministic for identical content", () => {
		const source = `
export function myFunction() {
  return "hello";
}
`;

		const chunks1 = chunkByStructure(source, { filePath: "test.ts" });
		const hierarchy1 = generateHierarchy(chunks1, "test.ts");

		const chunks2 = chunkByStructure(source, { filePath: "test.ts" });
		const hierarchy2 = generateHierarchy(chunks2, "test.ts");

		expect(hierarchy1.length).toBe(hierarchy2.length);
		for (let i = 0; i < hierarchy1.length; i++) {
			expect(hierarchy1[i]?.chunkId).toBe(hierarchy2[i]?.chunkId);
		}
	});

	it("different files produce different IDs for same content", () => {
		const source = `
export function helper() {
  return 1;
}
`;

		const chunks1 = chunkByStructure(source, { filePath: "utils1.ts" });
		const hierarchy1 = generateHierarchy(chunks1, "utils1.ts");

		const chunks2 = chunkByStructure(source, { filePath: "utils2.ts" });
		const hierarchy2 = generateHierarchy(chunks2, "utils2.ts");

		expect(hierarchy1.length).toBe(hierarchy2.length);
		for (let i = 0; i < hierarchy1.length; i++) {
			expect(hierarchy1[i]?.chunkId).not.toBe(hierarchy2[i]?.chunkId);
		}
	});

	it("markdown heading IDs stable when content added below", () => {
		const before = `
# Introduction

This is the intro.

## Details

Some details here.
`;

		const after = `
# Introduction

This is the intro.

## Details

Some details here.

## New Section

New content here.
`;

		const beforeChunks = chunkByStructure(before, { filePath: "doc.md" });
		const beforeHierarchy = generateHierarchy(beforeChunks, "doc.md");
		const introBefore = beforeHierarchy.find((c) => c.kind === "heading" && c.text.includes("Introduction"));

		const afterChunks = chunkByStructure(after, { filePath: "doc.md" });
		const afterHierarchy = generateHierarchy(afterChunks, "doc.md");
		const introAfter = afterHierarchy.find((c) => c.kind === "heading" && c.text.includes("Introduction"));

		expect(introBefore).toBeDefined();
		expect(introAfter).toBeDefined();
		expect(introBefore?.chunkId).toBe(introAfter?.chunkId);
	});

	it("class method IDs stable when another method added", () => {
		const before = `
class MyClass {
  method1() {
    return 1;
  }
  
  method2() {
    return 2;
  }
}
`;

		const after = `
class MyClass {
  method1() {
    return 1;
  }
  
  newMethod() {
    return 99;
  }
  
  method2() {
    return 2;
  }
}
`;

		const beforeChunks = chunkByStructure(before, { filePath: "class.ts" });
		const beforeHierarchy = generateHierarchy(beforeChunks, "class.ts");
		const method1Before = beforeHierarchy.find((c) => c.signature?.includes("method1"));

		const afterChunks = chunkByStructure(after, { filePath: "class.ts" });
		const afterHierarchy = generateHierarchy(afterChunks, "class.ts");
		const method1After = afterHierarchy.find((c) => c.signature?.includes("method1"));

		expect(method1Before).toBeDefined();
		expect(method1After).toBeDefined();
		expect(method1Before?.chunkId).toBe(method1After?.chunkId);
	});
});
