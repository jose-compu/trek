/** Effort balance controller (SPECS §8). */

/** Stop when spent cost exceeds this fraction of the prompt budget. */
export const EFFORT_BUDGET_RATIO = 0.9;

/** Tool-call budget for one prompt. The live loop spends 1 per tool. */
export const EFFORT_COST_BUDGET = 48;

/** Stop after this many tool calls in a row that return an error. */
export const EFFORT_NO_PROGRESS_LIMIT = 8;

/**
 * Stop on this many identical tool calls in one prompt.
 * The first call counts as 1, so 4 allows the same command three more times.
 */
export const EFFORT_REPEAT_LIMIT = 4;

/** Identical located errors before the turn stops. */
export const EFFORT_SAME_ERROR_LIMIT = 2;

/** No-op edits before the turn stops. */
export const EFFORT_NO_CHANGE_LIMIT = 2;

export const EFFORT_LOOSE_FACTOR = 10;

export type EffortMode = "off" | "normal" | "loose";

export interface EffortLimits {
	costBudget: number;
	noProgressLimit: number;
	repeatLimit: number;
	sameErrorLimit: number;
	noChangeLimit: number;
}

export function parseEffortMode(value: unknown): EffortMode | undefined {
	if (value === "off" || value === "normal" || value === "loose") {
		return value;
	}
	return undefined;
}

/** `undefined` means the regulator is off and must not stop the turn. */
export function effortLimitsFor(mode: EffortMode): EffortLimits | undefined {
	if (mode === "off") {
		return undefined;
	}
	const factor = mode === "loose" ? EFFORT_LOOSE_FACTOR : 1;
	return {
		costBudget: EFFORT_COST_BUDGET * factor,
		noProgressLimit: EFFORT_NO_PROGRESS_LIMIT * factor,
		repeatLimit: EFFORT_REPEAT_LIMIT * factor,
		sameErrorLimit: EFFORT_SAME_ERROR_LIMIT * factor,
		noChangeLimit: EFFORT_NO_CHANGE_LIMIT * factor,
	};
}

export function appendEffortReason<T extends { type: string; text?: string }>(content: T[], reason: string): T[] {
	const last = content[content.length - 1];
	if (last?.type === "text" && typeof last.text === "string") {
		if (last.text.includes(reason)) {
			return content;
		}
		return [...content.slice(0, -1), { ...last, text: `${last.text}\n${reason}` }];
	}
	return [...content, { type: "text", text: reason } as T];
}

export function effortActionKey(name: string, args: unknown): string {
	return `${name}:${canonical(args)}`;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonical(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

export class EffortRegulator {
	private consecutiveNoProgress = 0;
	private identicalActionCount = 0;
	private lastActionKey: string | undefined;
	private observationSkipped = false;
	private costUsed = 0;
	private costBudget: number | undefined;
	private noProgressLimit = EFFORT_NO_PROGRESS_LIMIT;
	private repeatLimit = EFFORT_REPEAT_LIMIT;
	private enabled = true;

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	applyLimits(limits: Pick<EffortLimits, "noProgressLimit" | "repeatLimit">): void {
		this.noProgressLimit = limits.noProgressLimit;
		this.repeatLimit = limits.repeatLimit;
		this.enabled = true;
	}

	markObservationSkipped(): void {
		this.observationSkipped = true;
	}

	recordObservation(observed: boolean): void {
		this.observationSkipped = !observed;
	}

	/** Reset spent cost for a new prompt. Loop counters stay. */
	setCostBudget(budget: number): void {
		this.costBudget = budget;
		this.costUsed = 0;
	}

	/** A new user prompt starts a new effort window. */
	beginPrompt(budget: number = EFFORT_COST_BUDGET): void {
		this.consecutiveNoProgress = 0;
		this.identicalActionCount = 0;
		this.lastActionKey = undefined;
		this.observationSkipped = false;
		this.setCostBudget(budget);
	}

	recordCost(amount: number): void {
		if (amount > 0) {
			this.costUsed += amount;
		}
	}

	stopReason(): string | undefined {
		if (!this.enabled) {
			return undefined;
		}
		if (this.consecutiveNoProgress >= this.noProgressLimit) {
			return "EffortRegulator stopped: no progress.";
		}
		if (this.identicalActionCount >= this.repeatLimit) {
			return "EffortRegulator stopped: repeated action.";
		}
		if (
			this.costBudget !== undefined &&
			this.costBudget > 0 &&
			this.costUsed / this.costBudget > EFFORT_BUDGET_RATIO
		) {
			return "EffortRegulator stopped: spent budget.";
		}
		if (this.observationSkipped) {
			return "EffortRegulator stopped: observation skipped.";
		}
		return undefined;
	}

	shouldContinue(): boolean {
		return this.stopReason() === undefined;
	}

	updateProgress(actionKey: string, madeProgress: boolean): void {
		if (this.lastActionKey === actionKey) {
			this.identicalActionCount += 1;
		} else {
			this.lastActionKey = actionKey;
			this.identicalActionCount = 1;
		}

		if (madeProgress) {
			this.consecutiveNoProgress = 0;
		} else {
			this.consecutiveNoProgress += 1;
		}
	}
}
