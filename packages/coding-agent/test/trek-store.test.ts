import { describe, expect, test } from "vitest";
import { parseBashPathOps } from "../src/core/trek-store/path-ops.ts";
import { type TrekStoreFs, TrekVersionStore } from "../src/core/trek-store/store.ts";

function createMemFs(): TrekStoreFs & { files: Map<string, string> } {
	const files = new Map<string, string>();
	return {
		files,
		async read(absPath) {
			return files.has(absPath) ? (files.get(absPath) as string) : null;
		},
		async write(absPath, content) {
			files.set(absPath, content);
		},
		async remove(absPath) {
			files.delete(absPath);
		},
		async mkdirp() {},
	};
}

describe("parseBashPathOps", () => {
	test("parses rm and mv, rejects pipes", () => {
		expect(parseBashPathOps("rm -f foo.ts")).toEqual([{ kind: "delete", path: "foo.ts" }]);
		expect(parseBashPathOps("mv src.ts dest.ts")).toEqual([{ kind: "rename", from: "src.ts", to: "dest.ts" }]);
		expect(parseBashPathOps("rm foo.ts | tee log")).toBeNull();
		expect(parseBashPathOps("echo hi")).toBeNull();
	});
});

describe("TrekVersionStore", () => {
	test("records three edits and restoreToPrompt(1) uses earliest pre-image", async () => {
		const fs = createMemFs();
		const cwd = "/proj";
		const store = new TrekVersionStore(cwd, fs, "/proj/.trek");

		await store.record({
			promptNumber: 1,
			promptId: "#1",
			relPath: "a.ts",
			kind: "edit",
			before: { kind: "content", content: "v0" },
			after: "v1",
		});
		await store.record({
			promptNumber: 2,
			promptId: "#2",
			relPath: "a.ts",
			kind: "edit",
			before: { kind: "content", content: "v1" },
			after: "v2",
		});
		await store.record({
			promptNumber: 3,
			promptId: "#3",
			relPath: "a.ts",
			kind: "edit",
			before: { kind: "content", content: "v2" },
			after: "v3",
		});

		fs.files.set("/proj/a.ts", "v3");
		const result = await store.restoreToPrompt(1);
		expect(result.restored).toEqual(["a.ts"]);
		expect(fs.files.get("/proj/a.ts")).toBe("v0");
		expect((await store.list()).some((r) => r.promptNumber >= 1)).toBe(false);
	});

	test("delete snapshot restores file bytes", async () => {
		const fs = createMemFs();
		const store = new TrekVersionStore("/proj", fs, "/proj/.trek");
		await store.record({
			promptNumber: 1,
			promptId: "#1",
			stepId: "#1:gone.ts",
			relPath: "gone.ts",
			kind: "delete",
			before: { kind: "content", content: "keep me" },
			after: null,
		});
		const result = await store.restoreToStep("#1:gone.ts");
		expect(result.restored).toEqual(["gone.ts"]);
		expect(fs.files.get("/proj/gone.ts")).toBe("keep me");
	});
});
