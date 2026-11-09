/**
 * Intent caption tests for #220.
 * Deterministic captions from docstrings, headings, first paragraphs.
 * No live LLM required.
 */

import { describe, expect, it } from "vitest";
import { generateCaption } from "../src/core/memory/caption-generator.ts";

describe("intent captions", () => {
	it("extracts docstring from TypeScript function", () => {
		const chunk = {
			text: `/**
 * Validates JWT token and returns user ID
 */
export function authenticate(token: string) {
  const decoded = jwt.verify(token);
  return decoded.userId;
}`,
			lineStart: 1,
			lineEnd: 7,
			signature: "authenticate(token: string)",
			kind: "function" as const,
		};

		const caption = generateCaption(chunk, "src/auth.ts");

		expect(caption).toContain("src/auth.ts");
		expect(caption).toContain("Validates JWT token");
		expect(caption).not.toContain("export function");
	});

	it("uses signature when no docstring present", () => {
		const chunk = {
			text: `export function compute(a: number, b: number) {
  return a + b;
}`,
			lineStart: 1,
			lineEnd: 3,
			signature: "compute(a: number, b: number)",
			kind: "function" as const,
		};

		const caption = generateCaption(chunk, "src/math.ts");

		expect(caption).toContain("src/math.ts");
		expect(caption).toContain("function compute(a: number, b: number)");
	});

	it("extracts Python docstring", () => {
		const chunk = {
			text: `def load_config():
    """Loads configuration from JSON file"""
    with open("config.json", "r") as f:
        return json.load(f)`,
			lineStart: 1,
			lineEnd: 4,
			signature: "load_config()",
			kind: "function" as const,
		};

		const caption = generateCaption(chunk, "config.py");

		expect(caption).toContain("config.py");
		expect(caption).toContain("Loads configuration");
	});

	it("uses heading text for Markdown heading chunks", () => {
		const chunk = {
			text: "## Configuration\n\nEdit the config file to set your API keys.",
			lineStart: 10,
			lineEnd: 12,
			kind: "heading" as const,
		};

		const caption = generateCaption(chunk, "README.md");

		expect(caption).toContain("README.md");
		expect(caption).toContain("Configuration");
		expect(caption).not.toContain("##");
	});

	it("extracts first paragraph for Markdown sections", () => {
		const chunk = {
			text: `# Installation

Run npm install to get started with the project. This will download all dependencies.

## Requirements

Node.js 16 or higher is required.`,
			lineStart: 1,
			lineEnd: 7,
			kind: "section" as const,
		};

		const caption = generateCaption(chunk, "docs/guide.md");

		expect(caption).toContain("docs/guide.md");
		expect(caption).toContain("Run npm install");
	});

	it("identifies code examples in fenced blocks", () => {
		const chunk = {
			text: '```typescript\nexport function hello() {\n  console.log("hello");\n}\n```',
			lineStart: 5,
			lineEnd: 9,
			kind: "fence" as const,
		};

		const caption = generateCaption(chunk, "examples.md");

		expect(caption).toContain("examples.md");
		expect(caption).toContain("typescript example");
	});

	it("handles class definitions", () => {
		const chunk = {
			text: `/**
 * Service for handling authentication
 */
export class AuthService {
  async login(user: string) {
    // ...
  }
}`,
			lineStart: 1,
			lineEnd: 8,
			signature: "AuthService",
			kind: "class" as const,
		};

		const caption = generateCaption(chunk, "src/service.ts");

		expect(caption).toContain("src/service.ts");
		expect(caption).toContain("Service for handling authentication");
	});

	it("does not require live LLM", () => {
		// All captions are deterministic from structure
		const chunk = {
			text: "function helper() { return true; }",
			lineStart: 1,
			lineEnd: 1,
			signature: "helper()",
			kind: "function" as const,
		};

		const caption1 = generateCaption(chunk, "utils.ts");
		const caption2 = generateCaption(chunk, "utils.ts");

		expect(caption1).toBe(caption2);
	});
});
