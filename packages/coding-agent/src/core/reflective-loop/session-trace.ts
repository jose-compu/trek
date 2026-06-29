import type { CustomEntry, SessionEntry, SessionManager } from "../session-manager.ts";
import type { ReflectiveCycleTrace } from "./types.ts";
import { REFLECTIVE_CYCLE_CUSTOM_TYPE } from "./types.ts";

export function appendReflectiveCycleTrace(sessionManager: SessionManager, trace: ReflectiveCycleTrace): string {
	return sessionManager.appendCustomEntry(REFLECTIVE_CYCLE_CUSTOM_TYPE, trace);
}

export function getReflectiveCycleTraces(entries: SessionEntry[]): ReflectiveCycleTrace[] {
	const traces: ReflectiveCycleTrace[] = [];
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === REFLECTIVE_CYCLE_CUSTOM_TYPE) {
			traces.push(entry.data as ReflectiveCycleTrace);
		}
	}
	return traces;
}

export function getReflectiveCycleCount(sessionManager: SessionManager): number {
	return getReflectiveCycleTraces(sessionManager.getEntries()).length;
}

export function isReflectiveCycleEntry(entry: SessionEntry): entry is CustomEntry<ReflectiveCycleTrace> {
	return entry.type === "custom" && entry.customType === REFLECTIVE_CYCLE_CUSTOM_TYPE;
}
