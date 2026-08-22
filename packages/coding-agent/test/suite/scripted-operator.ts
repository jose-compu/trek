/**
 * Scripted mock operator — drives AgentSession with faux LLM replies
 * and the same undo/keep-all/dry-run actions as TUI shortcuts.
 */

import type { FauxResponseStep } from "@trek/ai";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { KeybindingsManager } from "../../src/core/keybindings.ts";
import type { Harness } from "./harness.ts";

export type OperatorShortcut = "app.edits.undo" | "app.edits.keepAll" | "app.edits.dryRun";

export interface ScriptTurn {
	user: string;
	faux: FauxResponseStep[];
	after?: Array<OperatorShortcut | { slash: "/undo"; prompt?: number }>;
}

export class ScriptedOperator {
	readonly keys = new KeybindingsManager();
	private readonly harness: Harness;

	constructor(harness: Harness) {
		this.harness = harness;
	}

	get session(): AgentSession {
		return this.harness.session;
	}

	async submit(user: string, faux: FauxResponseStep[]): Promise<void> {
		this.harness.setResponses(faux);
		await this.session.prompt(user);
	}

	/** Fire the same session action the TUI binds to `shortcut`. */
	async shortcut(name: OperatorShortcut): Promise<void> {
		const bound = this.keys.getKeys(name);
		if (bound.length === 0) {
			throw new Error(`No default key for ${name}`);
		}
		if (name === "app.edits.undo") {
			const batches = this.session.listEditBatches();
			if (batches.length <= 1) {
				await this.session.undoLastEditBatches(1);
				return;
			}
			await this.session.undoLastEditBatches(1);
			return;
		}
		if (name === "app.edits.keepAll") {
			this.session.keepAllEdits();
			return;
		}
		this.session.setDryRun(!this.session.isDryRun());
	}

	async slashUndo(promptNumber?: number): Promise<void> {
		if (promptNumber !== undefined) {
			await this.session.undoToPrompt(promptNumber);
			return;
		}
		await this.session.undoLastEditBatches(1);
	}

	async selectUndoPrompt(promptNumber: number): Promise<void> {
		await this.session.undoToPrompt(promptNumber);
	}

	async run(script: ScriptTurn[]): Promise<void> {
		for (const turn of script) {
			await this.submit(turn.user, turn.faux);
			for (const action of turn.after ?? []) {
				if (typeof action === "string") {
					await this.shortcut(action);
				} else {
					await this.slashUndo(action.prompt);
				}
			}
		}
	}

	/** Default chord for a shortcut (used to prove bindings decode). */
	chord(name: OperatorShortcut): string {
		return this.keys.getKeys(name)[0] ?? "";
	}
}
