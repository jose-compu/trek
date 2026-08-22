/**
 * Edit-batch checkpoint store (issue #16 — multi-level Undo).
 *
 * An "edit batch" corresponds to a single prompt cycle (`#M`). Every `write`/`edit`
 * mutation made during that cycle records a pre-image of the affected file (the bytes
 * before the mutation, or a marker that the file did not exist). This lets the operator:
 *  - undo the last N edit batches, or
 *  - undo back to a specific prompt `#M` (reverting `#M` and everything after it).
 *
 * The store is intentionally pure/injectable: filesystem access is provided via
 * `CheckpointFsOps` so it is fully unit-testable. Persisting checkpoints to the session
 * JSONL (`trek:edit_batch_checkpoint`) and the deeper `.trek/` versioning layer (0.5.0)
 * build on top of this core.
 */

/** Prior state of a file before a batch first touched it. */
export type PreImage = { kind: "content"; content: string } | { kind: "absent" };

/** Filesystem operations the checkpoint store depends on (injectable for tests). */
export interface CheckpointFsOps {
	/** Read current file contents, or return `null` if the file does not exist. */
	read(absPath: string): Promise<string | null>;
	/** Write (create or overwrite) file contents. */
	write(absPath: string, content: string): Promise<void>;
	/** Remove a file. Must be a no-op (not throw) when the file is already absent. */
	remove(absPath: string): Promise<void>;
}

/** One prompt cycle's worth of file mutations. */
interface EditBatch {
	promptNumber: number;
	promptId: string;
	/** Earliest pre-image captured per absolute path during this batch (first capture wins). */
	files: Map<string, PreImage>;
}

/** JSON-serializable edit batch (session JSONL `trek:edit_batch_checkpoint`). */
export interface SerializedEditBatch {
	promptNumber: number;
	promptId: string;
	files: Array<{ path: string; pre: PreImage }>;
}

/** Full checkpoint snapshot persisted after capture / undo / Keep All. */
export interface SerializedCheckpoints {
	batches: SerializedEditBatch[];
}

/** Summary of a batch for UI/selectors. */
export interface BatchSummary {
	promptNumber: number;
	promptId: string;
	fileCount: number;
	paths: string[];
}

/** Outcome of an undo operation. */
export interface UndoResult {
	batchesUndone: number;
	/** Paths whose prior content was written back. */
	restored: string[];
	/** Paths that were deleted because they did not exist before the undone batches. */
	removed: string[];
}

export class EditCheckpointManager {
	/** Batches ordered oldest -> newest. */
	private batches: EditBatch[] = [];
	private readonly ops: CheckpointFsOps;

	constructor(ops: CheckpointFsOps) {
		this.ops = ops;
	}

	private batchFor(promptNumber: number, promptId: string): EditBatch {
		const existing = this.batches.find((b) => b.promptNumber === promptNumber);
		if (existing) {
			return existing;
		}
		const batch: EditBatch = { promptNumber, promptId, files: new Map() };
		this.batches.push(batch);
		// Keep oldest -> newest ordering even if captures arrive out of order.
		this.batches.sort((a, b) => a.promptNumber - b.promptNumber);
		return batch;
	}

	/**
	 * Capture the pre-image of `absPath` before a mutation in the given prompt batch.
	 * Returns true when a new pre-image was recorded (first capture per path per batch).
	 */
	async capture(promptNumber: number, promptId: string, absPath: string): Promise<boolean> {
		const batch = this.batchFor(promptNumber, promptId);
		if (batch.files.has(absPath)) {
			return false;
		}
		const content = await this.ops.read(absPath);
		batch.files.set(absPath, content === null ? { kind: "absent" } : { kind: "content", content });
		return true;
	}

	/** Record a pre-image without reading the filesystem (used when hydrating JSONL). */
	restoreCapture(promptNumber: number, promptId: string, absPath: string, pre: PreImage): void {
		const batch = this.batchFor(promptNumber, promptId);
		if (batch.files.has(absPath)) {
			return;
		}
		batch.files.set(absPath, pre);
	}

	/** Replace in-memory batches from a persisted snapshot (latest JSONL state wins). */
	hydrate(state: SerializedCheckpoints | undefined): void {
		this.batches = [];
		if (!state?.batches) {
			return;
		}
		for (const batch of state.batches) {
			for (const file of batch.files) {
				this.restoreCapture(batch.promptNumber, batch.promptId, file.path, file.pre);
			}
		}
	}

	/** Serialize current batches for session JSONL. */
	serialize(): SerializedCheckpoints {
		return {
			batches: this.batches.map((b) => ({
				promptNumber: b.promptNumber,
				promptId: b.promptId,
				files: [...b.files.entries()].map(([path, pre]) => ({ path, pre })),
			})),
		};
	}

	/** Look up the captured pre-image for a path in a prompt batch, if any. */
	getPreImage(promptNumber: number, absPath: string): PreImage | undefined {
		return this.batches.find((b) => b.promptNumber === promptNumber)?.files.get(absPath);
	}

	/** True when there is at least one undoable batch. */
	hasChanges(): boolean {
		return this.batches.length > 0;
	}

	/** Number of undoable batches currently tracked. */
	get depth(): number {
		return this.batches.length;
	}

	/** Batch summaries, newest first, for selectors/UI. */
	listBatches(): BatchSummary[] {
		return [...this.batches].reverse().map((b) => ({
			promptNumber: b.promptNumber,
			promptId: b.promptId,
			fileCount: b.files.size,
			paths: [...b.files.keys()],
		}));
	}

	/** Accept all pending edits (Keep All, issue #15): drop tracked checkpoints without touching disk. */
	keepAll(): void {
		this.batches = [];
	}

	/** Undo the most recent `n` edit batches (newest first). */
	async undoLastBatches(n: number): Promise<UndoResult> {
		if (n <= 0 || this.batches.length === 0) {
			return { batchesUndone: 0, restored: [], removed: [] };
		}
		const startIndex = Math.max(0, this.batches.length - n);
		return this._undoSuffix(startIndex);
	}

	/**
	 * Undo back to prompt `#M`: revert every batch with `promptNumber >= m`, restoring each
	 * affected file to its content just before `#M` first touched it.
	 */
	async undoToPrompt(m: number): Promise<UndoResult> {
		const startIndex = this.batches.findIndex((b) => b.promptNumber >= m);
		if (startIndex === -1) {
			return { batchesUndone: 0, restored: [], removed: [] };
		}
		return this._undoSuffix(startIndex);
	}

	/**
	 * Revert the contiguous suffix of batches starting at `startIndex` (inclusive).
	 *
	 * For each affected path we restore the EARLIEST pre-image within the undone window,
	 * because that reflects the file's content before the window began mutating it.
	 */
	private async _undoSuffix(startIndex: number): Promise<UndoResult> {
		const toUndo = this.batches.slice(startIndex);
		const earliest = new Map<string, PreImage>();
		for (const batch of toUndo) {
			for (const [path, pre] of batch.files) {
				if (!earliest.has(path)) {
					earliest.set(path, pre);
				}
			}
		}

		const restored: string[] = [];
		const removed: string[] = [];
		for (const [path, pre] of earliest) {
			if (pre.kind === "absent") {
				await this.ops.remove(path);
				removed.push(path);
			} else {
				await this.ops.write(path, pre.content);
				restored.push(path);
			}
		}

		this.batches = this.batches.slice(0, startIndex);
		return { batchesUndone: toUndo.length, restored, removed };
	}
}
