import { DEFAULT_MAX_SUBTASK_DEPTH } from "./types.ts";

export interface SubtaskFrame {
	description: string;
	parentSummary?: string;
}

/** Depth-first subtask stack (SPECS §4.1). */
export class SubtaskStack {
	private frames: SubtaskFrame[] = [];

	get depth(): number {
		return this.frames.length;
	}

	push(frame: SubtaskFrame): void {
		if (this.frames.length >= DEFAULT_MAX_SUBTASK_DEPTH) {
			throw new Error(`Subtask depth limit (${DEFAULT_MAX_SUBTASK_DEPTH}) exceeded.`);
		}
		this.frames.push(frame);
	}

	pop(): SubtaskFrame | undefined {
		return this.frames.pop();
	}

	current(): SubtaskFrame | undefined {
		return this.frames[this.frames.length - 1];
	}
}
