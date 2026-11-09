/**
 * Regression test for #233: 0.20-D start and turn must not await a full-tree reindex
 *
 * Acceptance criteria:
 * - start() returns before the background walk completes; watcher is already attached
 * - _captureTurnMemory does not await a full-tree walk
 * - Fake slow embedder: the next user prompt is accepted while status shows indexing
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Embedder, fakeEmbedder } from "../../../src/core/memory/embedder.ts";
import { MemoryManager } from "../../../src/core/memory/manager.ts";
import type { MemorySettings } from "../../../src/core/settings-manager.ts";

const dirs: string[] = [];

function project(name: string, fileCount = 10): string {
	const dir = mkdtempSync(join(tmpdir(), `trek-async-mem-${name}-`));
	dirs.push(dir);
	mkdirSync(join(dir, ".git"));
	writeFileSync(join(dir, "package.json"), "{}\n");
	for (let i = 0; i < fileCount; i++) {
		writeFileSync(join(dir, `file${i}.ts`), `export function fn${i}() { return ${i}; }\n`);
	}
	return dir;
}

function settings(extra: Partial<MemorySettings> = {}): Required<MemorySettings> {
	return { enabled: true, session: true, project: true, global: false, topK: 5, ...extra };
}

function slowEmbedder(delayMs = 50): Embedder {
	const base = fakeEmbedder();
	let embedCount = 0;
	return {
		...base,
		embed: async (text: string) => {
			embedCount++;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			return base.embed(text);
		},
		get embedCount() {
			return embedCount;
		},
	};
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

describe("async memory indexing", () => {
	it("start() returns before background indexing completes", async () => {
		const cwd = project("start-async", 20);
		const embedder = slowEmbedder(50);
		const mem = manager(cwd, "session-1", embedder);

		const startTime = Date.now();
		await mem.start();
		const elapsed = Date.now() - startTime;

		// start() should return quickly (< 200ms), not wait for all embeds
		// With 20 files at 50ms each, waiting would take ~1000ms
		expect(elapsed).toBeLessThan(200);

		// Status should show indexing in progress
		expect(mem.status()).toContain("indexing");

		// Wait for background indexing to complete
		await new Promise((resolve) => setTimeout(resolve, 1500));

		// After completion, status should show idle
		expect(mem.status()).toContain("idle");

		mem.close();
	});

	it("turn memory capture does not block on full reindex", async () => {
		const cwd = project("turn-async", 20);
		const embedder = slowEmbedder(50);
		const mem = manager(cwd, "session-1", embedder);

		await mem.start();
		// Wait for initial index to complete
		await new Promise((resolve) => setTimeout(resolve, 1500));

		const turnTime = Date.now();
		await mem.recordTurn(
			[
				{ role: "user", content: [{ type: "text", text: "test" }] },
				{ role: "assistant", content: [{ type: "text", text: "response" }] },
			] as never,
			cwd,
		);
		const turnElapsed = Date.now() - turnTime;

		// recordTurn should complete quickly, not wait for full reindex
		expect(turnElapsed).toBeLessThan(200);

		mem.close();
	});

	it("status shows indexing while background work continues", async () => {
		const cwd = project("status-indexing", 15);
		const embedder = slowEmbedder(80);
		const mem = manager(cwd, "session-1", embedder);

		await mem.start();

		// Immediately after start, should show indexing
		expect(mem.status()).toContain("indexing");

		// Can query status multiple times while indexing
		for (let i = 0; i < 3; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			const status = mem.status();
			expect(status).toMatch(/indexing|idle/);
		}

		// Wait for completion
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(mem.status()).toContain("idle");

		mem.close();
	});
});
