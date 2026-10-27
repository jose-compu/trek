/** Effort balance controller (SPECS §8). */

/** Stop when spent cost exceeds this fraction of the prompt budget. */
export const EFFORT_BUDGET_RATIO = 0.9;

/** Tool-call budget for one prompt. The live loop spends 1 per tool. */
export const EFFORT_COST_BUDGET = 24;

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

	recordCost(amount: number): void {
		if (amount > 0) {
			this.costUsed += amount;
		}
	}

	stopReason(): string | undefined {
		if (this.consecutiveNoProgress >= 3) {
			return "EffortRegulator stopped: no progress.";
		}
		if (this.identicalActionCount >= 2) {
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
