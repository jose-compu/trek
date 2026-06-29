import { describe, expect, test } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";

const noCtx = undefined as never;

describe("dry-run mode (#9)", () => {
	test("write: previews a diff and does not mutate", async () => {
		const writes: Array<[string, string]> = [];
		const mkdirs: string[] = [];
		const def = createWriteToolDefinition("/repo", {
			dryRun: () => true,
			operations: {
				writeFile: async (p, c) => {
					writes.push([p, c]);
				},
				mkdir: async (d) => {
					mkdirs.push(d);
				},
				readFile: async () => "old content\n",
			},
		});

		const result = await def.execute("1", { path: "a.txt", content: "new content\n" }, undefined, undefined, noCtx);

		expect(writes).toHaveLength(0);
		expect(mkdirs).toHaveLength(0);
		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.diff).toBeTruthy();
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect((result.content[0] as { text: string }).text).toMatch(/\[dry-run\]/);
	});

	test("write: applies normally when dry-run is off", async () => {
		const writes: Array<[string, string]> = [];
		const def = createWriteToolDefinition("/repo", {
			dryRun: () => false,
			operations: {
				writeFile: async (p, c) => {
					writes.push([p, c]);
				},
				mkdir: async () => {},
				readFile: async () => null,
			},
		});

		await def.execute("1", { path: "a.txt", content: "data" }, undefined, undefined, noCtx);
		expect(writes).toEqual([["/repo/a.txt", "data"]]);
	});

	test("edit: previews a diff/patch and does not write", async () => {
		const writes: Array<[string, string]> = [];
		const def = createEditToolDefinition("/repo", {
			dryRun: () => true,
			operations: {
				readFile: async () => Buffer.from("hello world\n", "utf-8"),
				writeFile: async (p, c) => {
					writes.push([p, c]);
				},
				access: async () => {},
			},
		});

		const result = await def.execute(
			"1",
			{ path: "a.txt", edits: [{ oldText: "world", newText: "there" }] },
			undefined,
			undefined,
			noCtx,
		);

		expect(writes).toHaveLength(0);
		expect(result.details?.dryRun).toBe(true);
		expect(result.details?.patch).toMatch(/there/);
		expect((result.content[0] as { text: string }).text).toMatch(/\[dry-run\]/);
	});

	test("bash: reports the command and does not execute", async () => {
		let execCalls = 0;
		const def = createBashToolDefinition("/repo", {
			dryRun: () => true,
			operations: {
				exec: async () => {
					execCalls += 1;
					return { exitCode: 0 };
				},
			},
		});

		const result = await def.execute("1", { command: "rm -rf build" }, undefined, undefined, noCtx);

		expect(execCalls).toBe(0);
		expect((result.content[0] as { text: string }).text).toMatch(/\[dry-run\] would execute/);
		expect((result.content[0] as { text: string }).text).toMatch(/rm -rf build/);
	});
});
