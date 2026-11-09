/**
 * Structure-aware chunking tests for #217.
 * Functions, classes, types stay intact. Signature overlap on body embed.
 */

import { describe, expect, it } from "vitest";
import { chunkByStructure, extractSignatureOverlap } from "../src/core/memory/structure-chunker.ts";

describe("structure-aware chunking", () => {
	it("chunks TypeScript file by functions, not line windows", () => {
		const code = `export function loadSettings() {
  const path = "./config.json";
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveSettings(data: object) {
  const path = "./config.json";
  writeFileSync(path, JSON.stringify(data, null, 2));
}`;

		const chunks = chunkByStructure(code, { filePath: "src/config.ts" });

		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.kind).toBe("function");
		expect(chunks[0]?.text).toContain("loadSettings");
		expect(chunks[0]?.text).toContain("return JSON.parse");
		expect(chunks[0]?.text).toContain("}");
		expect(chunks[0]?.text).not.toContain("saveSettings");
		expect(chunks[0]?.signature).toBe("loadSettings()");

		expect(chunks[1]?.kind).toBe("function");
		expect(chunks[1]?.text).toContain("saveSettings");
		expect(chunks[1]?.signature).toBe("saveSettings(data: object)");
	});

	it("keeps closing brace with function body, no orphan rows", () => {
		const code = `function compute() {
  return 42;
}`;

		const chunks = chunkByStructure(code, { filePath: "test.ts" });

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.text.trim()).toBe(code.trim());
		expect(chunks[0]?.text.endsWith("}")).toBe(true);
	});

	it("chunks classes as atomic units", () => {
		const code = `export class Service {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async fetch() {
    return await doFetch(this.url);
  }
}`;

		const chunks = chunkByStructure(code, { filePath: "src/service.ts" });

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.kind).toBe("class");
		expect(chunks[0]?.signature).toBe("Service");
		expect(chunks[0]?.text).toContain("constructor");
		expect(chunks[0]?.text).toContain("async fetch()");
	});

	it("chunks type and interface declarations", () => {
		const code = `export type Config = {
  apiKey: string;
  timeout: number;
};

export interface User {
  id: string;
  name: string;
}`;

		const chunks = chunkByStructure(code, { filePath: "types.ts" });

		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks.some((c) => c.kind === "type" && c.signature === "Config")).toBe(true);
		expect(chunks.some((c) => c.kind === "type" && c.signature === "User")).toBe(true);
	});

	it("extracts signature overlap for body embed", () => {
		const chunk = {
			text: `export function authenticate(token: string) {
  /** Validates JWT and returns user ID */
  const decoded = jwt.verify(token);
  return decoded.userId;
}`,
			lineStart: 1,
			lineEnd: 5,
			signature: "authenticate(token: string)",
			kind: "function" as const,
		};

		const overlap = extractSignatureOverlap(chunk);

		expect(overlap).toContain("authenticate(token: string)");
		expect(overlap).toContain("Validates JWT");
	});

	it("chunks Python functions by indentation", () => {
		const code = `def load_config():
    path = "./config.json"
    with open(path, "r") as f:
        return json.load(f)

def save_config(data):
    path = "./config.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2)`;

		const chunks = chunkByStructure(code, { filePath: "config.py" });

		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.kind).toBe("function");
		expect(chunks[0]?.text).toContain("load_config");
		expect(chunks[0]?.text).not.toContain("save_config");
		expect(chunks[0]?.signature).toBe("load_config()");

		expect(chunks[1]?.kind).toBe("function");
		expect(chunks[1]?.text).toContain("save_config");
		expect(chunks[1]?.signature).toBe("save_config(data)");
	});
});

describe("markdown chunking", () => {
	it("splits on ATX headings", () => {
		const md = `# Installation

Run npm install to get started.

## Configuration

Edit the config file.

### API Keys

Add your keys here.`;

		const chunks = chunkByStructure(md, { filePath: "README.md" });

		expect(chunks.length).toBeGreaterThanOrEqual(3);
		expect(chunks.some((c) => c.text.includes("# Installation"))).toBe(true);
		expect(chunks.some((c) => c.text.includes("## Configuration"))).toBe(true);
		expect(chunks.some((c) => c.text.includes("### API Keys"))).toBe(true);
	});

	it("keeps fenced code blocks atomic", () => {
		const md = `# Example

Here is some code:

\`\`\`typescript
export function hello() {
  console.log("hello");
}
\`\`\`

And more text.`;

		const chunks = chunkByStructure(md, { filePath: "guide.md" });

		const fenceChunk = chunks.find((c) => c.kind === "fence");
		expect(fenceChunk).toBeTruthy();
		expect(fenceChunk?.text).toContain("```typescript");
		expect(fenceChunk?.text).toContain("export function hello()");
		expect(fenceChunk?.text).toContain("```");
		expect(fenceChunk?.text.split("```")).toHaveLength(3);
	});

	it("handles Setext headings (=== and ---)", () => {
		const md = `Title
=====

Content here.

Subtitle
--------

More content.`;

		const chunks = chunkByStructure(md, { filePath: "doc.md" });

		expect(chunks.length).toBeGreaterThanOrEqual(2);
	});
});
