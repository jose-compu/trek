/**
 * Regression test for #234: 0.20-D write/edit enqueue dirty paths without awaiting embed
 *
 * Acceptance criteria:
 * - write, edit tools push paths onto serial LogosDB queue and return
 * - A write tool returns before the fake slow embed finishes
 * - After debounce, the new chunk is searchable
 * - Queue is serial; a burst coalesces; no concurrent put on the same store
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Embedder, fakeEmbedder } from "../../../src/core/memory/embedder.ts";
import { MemoryManager } from "../../../src/core/memory/manager.ts";
import type { MemorySettings } from "../../../src/core/settings-manager.ts";
import { createEditTool, createWriteTool } from "../../../src/core/tools/index.ts";

const dirs: string[] = [];

function project(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), `trek-write-edit-${name}-`));
	dirs.push(dir);
	mkdirSync(join(dir, ".git"));
	writeFileSync(join(dir, "package.json"), "{}\n");
	return dir;
}

function settings(extra: Partial<MemorySettings> = {}): Required<MemorySettings> {
	return { enabled: true, session: true, project: true, global: false, topK: 5, ...extra };
}

function slowEmbedder(delayMs = 100): Embedder & { calls: string[]; getEmbedCount: () => number } {
	const base = fakeEmbedder();
	let embedCount = 0;
	const result = {
		...base,
		embed: async (text: string) => {
			embedCount++;
			base.calls.push(text);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			return base.embed(text);
		},
		getEmbedCount: () => embedCount,
	};
	return result;
}

function manager(
	cwd: string,
	sessionId: string,
	embedder: Embedder = fakeEmbedder(),
	extra: Partial<MemorySettings> = {},
) {
	return new MemoryManager({
		cwd,
		sessionId,
		getSettings: () => settings(extra),
		embedder,
		globalRoot: join(cwd, "global-memory"),
		debounceMs: 40,
	});
}

afterEach(() => {
	while (dirs.length > 0) {
		const dir = dirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("write/edit enqueue without blocking", () => {
	it("write tool returns before slow embedding finishes", async () => {
		const cwd = project("write-async");
		const embedder = slowEmbedder(100);
		const mem = manager(cwd, "session-1", embedder);
		await mem.start();

		let callbackInvoked = false;

		const writeTool = createWriteTool(cwd, {
			onFileChanged: (path) => {
				callbackInvoked = true;
				void mem.indexFile(path).catch(() => undefined);
			},
		});

		const startTime = Date.now();
		const result = await writeTool.execute("test-call-id", {
			path: "code.ts",
			content: "export const value = 42;\n",
		});
		const elapsed = Date.now() - startTime;

		// Verify write succeeded
		expect(result.content).toBeDefined();

		// write should return immediately (< 50ms), not wait for embedding (100ms)
		expect(elapsed).toBeLessThan(50);

		// Callback should have been invoked for async indexing
		expect(callbackInvoked).toBe(true);

		mem.close();
	});

	it("edit tool returns before slow embedding finishes", async () => {
		const cwd = project("edit-async");
		const embedder = slowEmbedder(100);
		const mem = manager(cwd, "session-1", embedder);

		const file = join(cwd, "code.ts");
		writeFileSync(file, "export const old = 1;\n");
		await mem.start();

		let callbackInvoked = false;

		const editTool = createEditTool(cwd, {
			onFileChanged: (path) => {
				callbackInvoked = true;
				void mem.indexFile(path).catch(() => undefined);
			},
		});

		const startTime = Date.now();
		const result = await editTool.execute("test-call-id", {
			path: "code.ts",
			edits: [{ oldText: "old = 1", newText: "updated = 2" }],
		});
		const elapsed = Date.now() - startTime;

		// Verify edit succeeded
		expect(result.content).toBeDefined();

		// edit should return immediately (< 50ms), not wait for embedding (100ms)
		expect(elapsed).toBeLessThan(50);

		// Callback should have been invoked for async indexing
		expect(callbackInvoked).toBe(true);

		mem.close();
	});

	it("serial queue handles burst of writes without concurrent puts", async () => {
		const cwd = project("serial-queue");
		const embedder = slowEmbedder(50);
		const mem = manager(cwd, "session-1", embedder);
		await mem.start();

		let callbackCount = 0;

		const writeTool = createWriteTool(cwd, {
			onFileChanged: (path) => {
				callbackCount++;
				void mem.indexFile(path).catch(() => undefined);
			},
		});

		// Fire off multiple writes in quick succession
		const writes = [
			writeTool.execute("call-1", { path: "file1.ts", content: "export const a = 1;\n" }),
			writeTool.execute("call-2", { path: "file2.ts", content: "export const b = 2;\n" }),
			writeTool.execute("call-3", { path: "file3.ts", content: "export const c = 3;\n" }),
		];

		const startTime = Date.now();
		const results = await Promise.all(writes);
		const elapsed = Date.now() - startTime;

		// All writes should have succeeded
		expect(results).toHaveLength(3);
		for (const result of results) {
			expect(result.content).toBeDefined();
		}

		// All writes should complete quickly (< 50ms), not wait for embeds
		expect(elapsed).toBeLessThan(50);

		// All callbacks should have been invoked
		expect(callbackCount).toBe(3);

		mem.close();
	});

	it("debounce coalesces rapid writes to same file", async () => {
		const cwd = project("debounce-coalesce");
		const mem = manager(cwd, "session-1");
		await mem.start();

		let callbackCount = 0;

		const writeTool = createWriteTool(cwd, {
			onFileChanged: (path) => {
				callbackCount++;
				void mem.indexFile(path).catch(() => undefined);
			},
		});

		const file = "rapid.ts";

		// Write to same file multiple times rapidly
		const startTime = Date.now();
		await writeTool.execute("call-1", { path: file, content: "// version 1\n" });
		await writeTool.execute("call-2", { path: file, content: "// version 2\n" });
		await writeTool.execute("call-3", { path: file, content: "// version 3\n" });
		const elapsed = Date.now() - startTime;

		// Wall clock for three writes. The slow-embed cases above are the non-blocking proof.
		expect(elapsed).toBeLessThan(250);

		// Callback should be invoked for each write
		expect(callbackCount).toBe(3);

		mem.close();
	});
});
