import type { CustomEntry, SessionEntry, SessionManager } from "../session-manager.ts";
import {
	appendReflectiveCycleTrace as appendTrace,
	getReflectiveCycleCount as countTraces,
	isReflectiveCycleEntry as isCycleEntry,
	getReflectiveCycleTraces as listTraces,
} from "../trace/index.ts";
import type { ReflectiveCycleTrace } from "./types.ts";

export function appendReflectiveCycleTrace(sessionManager: SessionManager, trace: ReflectiveCycleTrace): string {
	return appendTrace(sessionManager, trace);
}

export function getReflectiveCycleTraces(entries: SessionEntry[]): ReflectiveCycleTrace[] {
	return listTraces(entries);
}

export function getReflectiveCycleCount(sessionManager: SessionManager): number {
	return countTraces(sessionManager);
}

export function isReflectiveCycleEntry(entry: SessionEntry): entry is CustomEntry<ReflectiveCycleTrace> {
	return isCycleEntry(entry);
}
