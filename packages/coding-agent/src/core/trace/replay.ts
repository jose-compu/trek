import type { SessionManager } from "../session-manager.ts";
import { findCycleTrace, forkLeafId } from "./query.ts";

export const COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE = "trek:counterfactual_observe";

export interface CounterfactualObserve {
	schemaVersion: 1;
	cycleId: string;
	observe: string;
}

export function replayCounterfactual(
	manager: SessionManager,
	selector: string,
	observe: string,
): { path: string; cycleId: string } {
	const located = findCycleTrace(manager.getEntries(), selector);
	if (!located) {
		throw new Error(`Cycle not found: ${selector}`);
	}
	const path = manager.createBranchedSession(forkLeafId(manager.getEntries(), located));
	if (!path) {
		throw new Error("Replay requires a persisted session with an assistant turn.");
	}
	const payload: CounterfactualObserve = {
		schemaVersion: 1,
		cycleId: located.trace.cycleId,
		observe,
	};
	manager.appendCustomEntry(COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE, payload);
	return { path, cycleId: located.trace.cycleId };
}
