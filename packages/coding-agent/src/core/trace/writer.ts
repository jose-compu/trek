import type { ReflectiveCycleTrace } from "../reflective-loop/types.ts";
import { REFLECTIVE_CYCLE_CUSTOM_TYPE } from "../reflective-loop/types.ts";
import type { SessionEntry, SessionManager } from "../session-manager.ts";
import { parseCycleTraceFromEntry } from "./schema.ts";

export const CYCLE_CHECKPOINT_CUSTOM_TYPE = "trek:cycle_checkpoint";

export interface CycleCheckpoint {
	cycleId: string;
	cycleNumber: number;
	promptId?: string;
}

export function appendReflectiveCycleTrace(sessionManager: SessionManager, trace: ReflectiveCycleTrace): string {
	return sessionManager.appendCustomEntry(REFLECTIVE_CYCLE_CUSTOM_TYPE, trace);
}

export function appendCycleCheckpoint(sessionManager: SessionManager, checkpoint: CycleCheckpoint): string {
	return sessionManager.appendCustomEntry(CYCLE_CHECKPOINT_CUSTOM_TYPE, checkpoint);
}

export function persistCycleBoundary(sessionManager: SessionManager, trace: ReflectiveCycleTrace): void {
	sessionManager.appendCustomEntries([
		{ customType: REFLECTIVE_CYCLE_CUSTOM_TYPE, data: trace },
		{
			customType: CYCLE_CHECKPOINT_CUSTOM_TYPE,
			data: {
				cycleId: trace.cycleId,
				cycleNumber: trace.cycleNumber,
				promptId: trace.promptId,
			} satisfies CycleCheckpoint,
		},
	]);
}

function parseCycleCheckpoint(data: unknown): CycleCheckpoint | undefined {
	if (!data || typeof data !== "object") {
		return undefined;
	}
	const rec = data as Record<string, unknown>;
	if (typeof rec.cycleId !== "string" || typeof rec.cycleNumber !== "number") {
		return undefined;
	}
	const checkpoint: CycleCheckpoint = { cycleId: rec.cycleId, cycleNumber: rec.cycleNumber };
	if (typeof rec.promptId === "string") {
		checkpoint.promptId = rec.promptId;
	}
	return checkpoint;
}

export function getLatestCycleCheckpoint(entries: SessionEntry[]): CycleCheckpoint | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "custom" && entry.customType === CYCLE_CHECKPOINT_CUSTOM_TYPE) {
			return parseCycleCheckpoint(entry.data);
		}
	}
	return undefined;
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
	const entries = sessionManager.getEntries();
	const checkpoint = getLatestCycleCheckpoint(entries);
	if (checkpoint) {
		return checkpoint.cycleNumber;
	}
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === REFLECTIVE_CYCLE_CUSTOM_TYPE) {
			count++;
		}
	}
	return count;
}
