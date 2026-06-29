/** Effort balance controller (SPECS §8). */
export class EffortRegulator {
	private consecutiveNoProgress = 0;
	private identicalActionCount = 0;
	private lastActionKey: string | undefined;
	private observationSkipped = false;

	markObservationSkipped(): void {
		this.observationSkipped = true;
	}

	recordObservation(observed: boolean): void {
		this.observationSkipped = !observed;
	}

	shouldContinue(): boolean {
		if (this.observationSkipped) {
			return false;
		}
		if (this.consecutiveNoProgress >= 3) {
			return false;
		}
		if (this.identicalActionCount >= 2) {
			return false;
		}
		return true;
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
