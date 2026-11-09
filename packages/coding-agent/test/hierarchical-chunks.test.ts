/**
 * Hierarchical chunking tests for #218.
 * Each leaf has a parent summary chunk for contextual recall.
 */

import { describe, expect, it } from "vitest";
import { generateHierarchy } from "../src/core/memory/hierarchy.ts";
import { chunkByStructure } from "../src/core/memory/structure-chunker.ts";

describe("hierarchical chunks", () => {
	it("creates leaf and parent for functions in a class", () => {
		const code = `export class AuthService {
  async login(username: string, password: string) {
    const user = await db.findUser(username);
    if (!user) throw new Error("User not found");
    return user;
  }

  async logout(sessionId: string) {
    await db.deleteSession(sessionId);
  }
}`;

		const structures = chunkByStructure(code, { filePath: "src/auth.ts" });
		const hierarchical = generateHierarchy(structures, "src/auth.ts");

		// Should have parent for class + leaves for functions
		expect(hierarchical.length).toBeGreaterThanOrEqual(2);

		const classParent = hierarchical.find((c) => c.isParent && c.kind === "class");
		expect(classParent).toBeTruthy();
		expect(classParent?.chunkId).toContain("AuthService");

		const loginLeaf = hierarchical.find((c) => !c.isParent && c.text.includes("login"));
		expect(loginLeaf).toBeTruthy();
		expect(loginLeaf?.parentId).toBeTruthy();
		expect(loginLeaf?.parentContext).toContain("class AuthService");
	});

	it("creates leaf and parent for file-level functions", () => {
		const code = `export function authenticate(token: string) {
  const decoded = jwt.verify(token);
  return decoded.userId;
}

export function validateToken(token: string) {
  return jwt.decode(token) !== null;
}`;

		const structures = chunkByStructure(code, { filePath: "src/utils.ts" });
		const hierarchical = generateHierarchy(structures, "src/utils.ts");

		const leaves = hierarchical.filter((c) => !c.isParent);
		expect(leaves.length).toBeGreaterThanOrEqual(2);

		const authLeaf = leaves.find((c) => c.text.includes("authenticate"));
		expect(authLeaf?.parentId).toBeTruthy();
		expect(authLeaf?.parentContext).toContain("file");
	});

	it("creates markdown breadcrumb for nested headings", () => {
		const md = `# Release

## Deploy

### Production

Deploy to production with caution.

### Staging

Deploy to staging for testing.`;

		const structures = chunkByStructure(md, { filePath: "docs/process.md" });
		const hierarchical = generateHierarchy(structures, "docs/process.md");

		const prodParent = hierarchical.find((c) => c.isParent && c.text.includes("Production"));
		expect(prodParent).toBeTruthy();
		expect(prodParent?.text).toContain("Release > Deploy > Production");

		const prodLeaf = hierarchical.find((c) => !c.isParent && c.text.includes("Deploy to production with caution"));
		expect(prodLeaf).toBeTruthy();
		expect(prodLeaf?.parentId).toBe(prodParent?.chunkId);
		expect(prodLeaf?.parentContext).toContain("Release > Deploy > Production");
	});

	it("has both leaf and parent ids in the same fixture", () => {
		const code = `class Repo {
  save(data: object) {
    db.insert(data);
  }
}`;

		const structures = chunkByStructure(code, { filePath: "repo.ts" });
		const hierarchical = generateHierarchy(structures, "repo.ts");

		const parent = hierarchical.find((c) => c.isParent);
		const leaf = hierarchical.find((c) => !c.isParent && c.kind === "function");

		expect(parent?.chunkId).toBeTruthy();
		expect(leaf?.chunkId).toBeTruthy();
		expect(leaf?.parentId).toBe(parent?.chunkId);
	});
});
