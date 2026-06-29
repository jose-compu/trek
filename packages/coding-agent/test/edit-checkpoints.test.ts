import { describe, expect, test } from "vitest";
import { type CheckpointFsOps, EditCheckpointManager } from "../src/core/edit-checkpoints/index.ts";

/** In-memory filesystem: a path present in the map exists; absent from the map means no file. */
function createFakeFs(initial: Record<string, string> = {}): CheckpointFsOps & {
	state: Map<string, string>;
} {
	const state = new Map<string, string>(Object.entries(initial));
	return {
		state,
		async read(absPath: string): Promise<string | null> {
			return state.has(absPath) ? (state.get(absPath) as string) : null;
		},
		async write(absPath: string, content: string): Promise<void> {
			state.set(absPath, content);
		},
		async remove(absPath: string): Promise<void> {
			state.delete(absPath);
		},
	};
}

/** Simulate one prompt cycle: capture pre-images, then apply the mutations. */
async function applyBatch(
	mgr: EditCheckpointManager,
	fs: CheckpointFsOps,
	promptNumber: number,
	mutations: Record<string, string>,
): Promise<void> {
	for (const [path, content] of Object.entries(mutations)) {
		await mgr.capture(promptNumber, `#${promptNumber}`, path);
		await fs.write(path, content);
	}
}

describe("EditCheckpointManager", () => {
	test("undo last batch restores prior content only", async () => {
		const fs = createFakeFs({ "/a.txt": "v0" });
		const mgr = new EditCheckpointManager(fs);

		await applyBatch(mgr, fs, 1, { "/a.txt": "v1" });
		await applyBatch(mgr, fs, 2, { "/a.txt": "v2" });
		await applyBatch(mgr, fs, 3, { "/a.txt": "v3" });
		expect(fs.state.get("/a.txt")).toBe("v3");

		const result = await mgr.undoLastBatches(1);
		expect(result.batchesUndone).toBe(1);
		expect(result.restored).toEqual(["/a.txt"]);
		// Undoing batch #3 restores the content captured at the start of #3, which is v2.
		expect(fs.state.get("/a.txt")).toBe("v2");
		expect(mgr.depth).toBe(2);
	});

	test("undo -2 restores content from two batches back", async () => {
		const fs = createFakeFs({ "/a.txt": "v0" });
		const mgr = new EditCheckpointManager(fs);

		await applyBatch(mgr, fs, 1, { "/a.txt": "v1" });
		await applyBatch(mgr, fs, 2, { "/a.txt": "v2" });
		await applyBatch(mgr, fs, 3, { "/a.txt": "v3" });

		const result = await mgr.undoLastBatches(2);
		expect(result.batchesUndone).toBe(2);
		// Reverting batches #2 and #3 restores the earliest pre-image in that window = v1.
		expect(fs.state.get("/a.txt")).toBe("v1");
		expect(mgr.depth).toBe(1);
	});

	test("undo to prompt #M reverts #M and everything after, across multiple files", async () => {
		const fs = createFakeFs({ "/a.txt": "a0", "/b.txt": "b0" });
		const mgr = new EditCheckpointManager(fs);

		await applyBatch(mgr, fs, 1, { "/a.txt": "a1" });
		await applyBatch(mgr, fs, 2, { "/a.txt": "a2", "/b.txt": "b2" });
		await applyBatch(mgr, fs, 3, { "/b.txt": "b3" });

		const result = await mgr.undoToPrompt(2);
		expect(result.batchesUndone).toBe(2);
		// a.txt reverts to its pre-#2 value (a1); b.txt reverts to its pre-#2 value (b0).
		expect(fs.state.get("/a.txt")).toBe("a1");
		expect(fs.state.get("/b.txt")).toBe("b0");
		expect(mgr.depth).toBe(1);
	});

	test("file created by a batch is removed when that batch is undone", async () => {
		const fs = createFakeFs();
		const mgr = new EditCheckpointManager(fs);

		await applyBatch(mgr, fs, 1, { "/new.txt": "created" });
		expect(fs.state.has("/new.txt")).toBe(true);

		const result = await mgr.undoLastBatches(1);
		expect(result.removed).toEqual(["/new.txt"]);
		expect(fs.state.has("/new.txt")).toBe(false);
	});

	test("first capture per path within a batch wins (repeated edits in one cycle)", async () => {
		const fs = createFakeFs({ "/a.txt": "v0" });
		const mgr = new EditCheckpointManager(fs);

		// Two mutations to the same file in the SAME prompt cycle.
		await mgr.capture(1, "#1", "/a.txt");
		await fs.write("/a.txt", "mid");
		await mgr.capture(1, "#1", "/a.txt");
		await fs.write("/a.txt", "final");

		await mgr.undoLastBatches(1);
		expect(fs.state.get("/a.txt")).toBe("v0");
	});

	test("keepAll drops checkpoints without touching disk", async () => {
		const fs = createFakeFs({ "/a.txt": "v0" });
		const mgr = new EditCheckpointManager(fs);
		await applyBatch(mgr, fs, 1, { "/a.txt": "v1" });

		mgr.keepAll();
		expect(mgr.hasChanges()).toBe(false);
		expect(fs.state.get("/a.txt")).toBe("v1");

		const result = await mgr.undoLastBatches(1);
		expect(result.batchesUndone).toBe(0);
		expect(fs.state.get("/a.txt")).toBe("v1");
	});

	test("listBatches returns newest first with file counts", async () => {
		const fs = createFakeFs({ "/a.txt": "a0", "/b.txt": "b0" });
		const mgr = new EditCheckpointManager(fs);
		await applyBatch(mgr, fs, 1, { "/a.txt": "a1" });
		await applyBatch(mgr, fs, 2, { "/a.txt": "a2", "/b.txt": "b2" });

		const summaries = mgr.listBatches();
		expect(summaries.map((s) => s.promptNumber)).toEqual([2, 1]);
		expect(summaries[0]).toMatchObject({ promptId: "#2", fileCount: 2 });
		expect(summaries[1]).toMatchObject({ promptId: "#1", fileCount: 1 });
	});

	test("undoToPrompt with no matching batch is a no-op", async () => {
		const fs = createFakeFs({ "/a.txt": "v0" });
		const mgr = new EditCheckpointManager(fs);
		await applyBatch(mgr, fs, 1, { "/a.txt": "v1" });

		const result = await mgr.undoToPrompt(5);
		expect(result.batchesUndone).toBe(0);
		expect(fs.state.get("/a.txt")).toBe("v1");
		expect(mgr.depth).toBe(1);
	});
});
