import type { ReflectiveCycleTrace } from "../reflective-loop/types.ts";
import { REFLECTIVE_CYCLE_CUSTOM_TYPE } from "../reflective-loop/types.ts";
import type { SessionEntry, SessionManager } from "../session-manager.ts";
import { parseCycleTraceFromEntry } from "./schema.ts";

export function appendReflectiveCycleTrace(sessionManager: SessionManager, trace: ReflectiveCycleTrace): string {
	return sessionManager.appendCustomEntry(REFLECTIVE_CYCLE_CUSTOM_TYPE, trace);
}

export function getReflectiveCycleTraces(entries: SessionEntry[]): ReflectiveCycleTrace[] {
	const traces: ReflectiveCycleTrace[] = [];
	for (const entry of entries) {
		const parsed = parseCycleTraceFromEntry(entry);
		if (parsed) {
			traces.push(parsed);
		}
	}
	return traces;
}

export function getReflectiveCycleCount(sessionManager: SessionManager): number {
	return getReflectiveCycleTraces(sessionManager.getEntries()).length;
}
