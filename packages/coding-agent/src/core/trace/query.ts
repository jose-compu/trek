import type { ReflectiveCycleTrace } from "../reflective-loop/types.ts";
import type { CustomEntry, SessionEntry } from "../session-manager.ts";
import { isReflectiveCycleEntry, parseCycleTraceFromEntry } from "./schema.ts";
import { CYCLE_CHECKPOINT_CUSTOM_TYPE, getReflectiveCycleTraces } from "./writer.ts";

export interface LocatedCycleTrace {
	entry: CustomEntry<unknown>;
	trace: ReflectiveCycleTrace;
}

export function locateCycleTraces(entries: SessionEntry[]): LocatedCycleTrace[] {
	const found: LocatedCycleTrace[] = [];
	for (const entry of entries) {
		if (!isReflectiveCycleEntry(entry)) {
			continue;
		}
		const trace = parseCycleTraceFromEntry(entry);
		if (trace) {
			found.push({ entry, trace });
		}
	}
	return found;
}

/** Match `c-0001`, numeric cycle number, JSONL entry id, or prompt id (`#1`). */
export function findCycleTrace(entries: SessionEntry[], selector: string): LocatedCycleTrace | undefined {
	const needle = selector.trim();
	if (!needle) {
		return undefined;
	}
	const located = locateCycleTraces(entries);
	const byCycleId = located.find((item) => item.trace.cycleId === needle);
	if (byCycleId) {
		return byCycleId;
	}
	const byEntryId = located.find((item) => item.entry.id === needle);
	if (byEntryId) {
		return byEntryId;
	}
	if (needle.startsWith("#")) {
		return located.find((item) => item.trace.promptId === needle);
	}
	const asNumber = Number(needle);
	if (Number.isInteger(asNumber) && asNumber > 0) {
		return located.find((item) => item.trace.cycleNumber === asNumber);
	}
	return undefined;
}

/** Include the cycle-boundary checkpoint child, if present, so resume keeps the last completed cycle. */
export function forkLeafId(entries: SessionEntry[], located: LocatedCycleTrace): string {
	const checkpoint = entries.find(
		(entry) =>
			entry.parentId === located.entry.id &&
			entry.type === "custom" &&
			entry.customType === CYCLE_CHECKPOINT_CUSTOM_TYPE,
	);
	return checkpoint?.id ?? located.entry.id;
}

export interface IntentionOutcomeDiff {
	intend: string;
	act: string;
	tools: string[];
	blocked: boolean;
	skipped: boolean;
	status: "blocked" | "skipped" | "diverged" | "matched";
}

export function diffIntentionOutcome(trace: ReflectiveCycleTrace): IntentionOutcomeDiff {
	const intend = trace.phases.intend.summary;
	const act = trace.phases.act.summary;
	const blocked = Boolean(trace.phases.intend.blocked);
	const skipped = Boolean(trace.phases.act.skipped);
	let status: IntentionOutcomeDiff["status"] = "matched";
	if (blocked) {
		status = "blocked";
	} else if (skipped) {
		status = "skipped";
	} else if (intend !== act) {
		status = "diverged";
	}
	return {
		intend,
		act,
		tools: trace.toolNames,
		blocked,
		skipped,
		status,
	};
}

export function listCycleSummaries(entries: SessionEntry[]): Array<{
	cycleId: string;
	promptId?: string;
	taskPreview: string;
	tools: string[];
	lawsPreAllowed?: boolean;
}> {
	return getReflectiveCycleTraces(entries).map((trace) => ({
		cycleId: trace.cycleId,
		promptId: trace.promptId,
		taskPreview: trace.taskPreview,
		tools: trace.toolNames,
		lawsPreAllowed: trace.lawsVerdict.pre?.allowed,
	}));
}
