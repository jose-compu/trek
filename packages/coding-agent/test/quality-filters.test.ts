/**
 * Quality filter tests for #223.
 * License headers, @generated, minified, and empty barrels are not indexed.
 */

import { describe, expect, it } from "vitest";
import { filterChunks, shouldIndexChunk } from "../src/core/memory/quality-filters.ts";

describe("quality filters", () => {
	it("skips license headers", () => {
		const license = `/**
 * MIT License
 * 
 * Copyright (c) 2024 Author
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files.
 */`;

		const result = shouldIndexChunk(license, "src/utils.ts");
		expect(result.shouldIndex).toBe(false);
		expect(result.reason).toBe("license header");
	});

	it("skips @generated files", () => {
		const generated = `// @generated
// This file was automatically generated and should not be edited.

export interface User {
  id: string;
  name: string;
}`;

		const result = shouldIndexChunk(generated, "src/types.ts");
		expect(result.shouldIndex).toBe(false);
		expect(result.reason).toBe("generated file");
	});

	it("skips minified one-liners", () => {
		const minified =
			"function a(){return b(c(d(e(f(g(h(i(j(k(l(m(n(o(p(q(r(s(t(u(v(w(x(y(z(1,2,3,4,5,6,7,8,9,0)))))))))))))))))))))))))}";

		const result = shouldIndexChunk(minified, "bundle.js");
		expect(result.shouldIndex).toBe(false);
		expect(result.reason).toBe("minified");
	});

	it("skips empty re-export barrels", () => {
		const barrel = `export { foo } from "./foo.ts";
export { bar } from "./bar.ts";
export { baz } from "./baz.ts";`;

		const result = shouldIndexChunk(barrel, "src/index.ts");
		expect(result.shouldIndex).toBe(false);
		expect(result.reason).toBe("empty barrel");
	});

	it("indexes normal function next to license header", () => {
		const chunks = [
			{
				text: `/**
 * Copyright (c) 2024 Author
 * Licensed under MIT License
 */`,
				kind: "unknown" as const,
			},
			{
				text: `export function authenticate(token: string) {
  const decoded = jwt.verify(token);
  return decoded.userId;
}`,
				kind: "function" as const,
			},
		];

		const filtered = filterChunks(chunks, "auth.ts");

		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.text).toContain("authenticate");
		expect(filtered[0]?.text).not.toContain("Copyright");
	});

	it("indexes real code that's not minified", () => {
		const normal = `export function compute(a: number, b: number): number {
  const sum = a + b;
  const product = a * b;
  return sum + product;
}`;

		const result = shouldIndexChunk(normal, "math.ts");
		expect(result.shouldIndex).toBe(true);
	});

	it("indexes markdown with tables", () => {
		const markdown = `# Results

| Name | Score |
|------|-------|
| Alice | 95 |
| Bob | 87 |

The table shows test scores.`;

		const result = shouldIndexChunk(markdown, "results.md");
		expect(result.shouldIndex).toBe(true);
	});

	it("skips files with .generated. in the name", () => {
		const code = `export interface Model {
  id: string;
}`;

		const result = shouldIndexChunk(code, "src/models.generated.ts");
		expect(result.shouldIndex).toBe(false);
		expect(result.reason).toBe("generated file");
	});

	it("indexes barrels with actual implementations", () => {
		const barrelWithCode = `export { foo } from "./foo.ts";

export function helper() {
  return "local utility";
}

export class Service {
  start() {
    console.log("started");
  }
}`;

		const result = shouldIndexChunk(barrelWithCode, "utils/index.ts");
		expect(result.shouldIndex).toBe(true);
	});
});
