import {
	type LawsVerdictPair,
	type LawsVerdictRecord,
	REFLECTIVE_CYCLE_CUSTOM_TYPE,
	type ReflectiveComponentRecord,
	type ReflectiveCycleTrace,
	type ReflectivePhase,
	type ReflectivePhaseRecord,
	TRACE_SCHEMA_VERSION,
	type TracePhaseTimestamps,
} from "../reflective-loop/types.ts";
import type { CustomEntry, SessionEntry } from "../session-manager.ts";

const PHASES: ReflectivePhase[] = ["observe", "intend", "act", "reflect"];

export { REFLECTIVE_CYCLE_CUSTOM_TYPE, TRACE_SCHEMA_VERSION };
export type { LawsVerdictPair, LawsVerdictRecord, ReflectiveCycleTrace, ReflectivePhase, TracePhaseTimestamps };

/** Human-readable cycle id unique within a session (`c-0001`). */
export function createCycleId(cycleNumber: number): string {
	return `c-${String(cycleNumber).padStart(4, "0")}`;
}

export function nowIso(clock: () => Date = () => new Date()): string {
	return clock().toISOString();
}

export function isReflectiveCycleEntry(entry: SessionEntry): entry is CustomEntry<unknown> {
	return entry.type === "custom" && entry.customType === REFLECTIVE_CYCLE_CUSTOM_TYPE;
}

function isPhaseRecord(value: unknown): value is ReflectivePhaseRecord {
	if (!value || typeof value !== "object") {
		return false;
	}
	const rec = value as ReflectivePhaseRecord;
	return typeof rec.phase === "string" && typeof rec.summary === "string";
}

function isPhases(value: unknown): value is Record<ReflectivePhase, ReflectivePhaseRecord> {
	if (!value || typeof value !== "object") {
		return false;
	}
	const rec = value as Record<string, unknown>;
	return PHASES.every((phase) => isPhaseRecord(rec[phase]));
}

function asLawsVerdict(value: unknown): LawsVerdictRecord | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const rec = value as Record<string, unknown>;
	if (typeof rec.allowed !== "boolean") {
		return undefined;
	}
	const verdict: LawsVerdictRecord = { allowed: rec.allowed };
	if (typeof rec.law === "number") {
		verdict.law = rec.law;
	}
	if (typeof rec.reason === "string") {
		verdict.reason = rec.reason;
	}
	return verdict;
}

/** Accept schema v1 `{ pre, post }` and legacy flat `{ allowed, law, reason }`. */
export function normalizeLawsVerdict(raw: unknown): LawsVerdictPair {
	if (!raw || typeof raw !== "object") {
		return {};
	}
	const rec = raw as Record<string, unknown>;
	if ("pre" in rec || "post" in rec) {
		return { pre: asLawsVerdict(rec.pre), post: asLawsVerdict(rec.post) };
	}
	const legacy = asLawsVerdict(raw);
	return legacy ? { pre: legacy } : {};
}

function parsePhaseTimestamps(raw: unknown): Partial<Record<ReflectivePhase, TracePhaseTimestamps>> {
	if (!raw || typeof raw !== "object") {
		return {};
	}
	const out: Partial<Record<ReflectivePhase, TracePhaseTimestamps>> = {};
	const rec = raw as Record<string, unknown>;
	for (const phase of PHASES) {
		const item = rec[phase];
		if (!item || typeof item !== "object") {
			continue;
		}
		const ts = item as Record<string, unknown>;
		if (typeof ts.startedAt !== "string") {
			continue;
		}
		out[phase] = {
			startedAt: ts.startedAt,
			endedAt: typeof ts.endedAt === "string" ? ts.endedAt : undefined,
		};
	}
	return out;
}

function parseToolNames(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter((name): name is string => typeof name === "string" && name.length > 0);
}

export interface ParseCycleTraceOptions {
	/** Used when the payload has no startedAt/endedAt (pre-0.6.0 traces). */
	fallbackTimestamp?: string;
}

/**
 * Parse a `trek:reflective_cycle` payload into schema v1.
 * Legacy unversioned records are upgraded in memory (lawsVerdict.pre from the flat verdict).
 */
export function parseCycleTrace(data: unknown, options: ParseCycleTraceOptions = {}): ReflectiveCycleTrace | undefined {
	if (!data || typeof data !== "object") {
		return undefined;
	}
	const raw = data as Record<string, unknown>;
	if (typeof raw.cycleNumber !== "number" || !Number.isFinite(raw.cycleNumber)) {
		return undefined;
	}
	if (!isPhases(raw.phases)) {
		return undefined;
	}

	const fallback = options.fallbackTimestamp ?? new Date(0).toISOString();
	const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : fallback;
	const endedAt = typeof raw.endedAt === "string" ? raw.endedAt : startedAt;
	const components = Array.isArray(raw.components) ? (raw.components as ReflectiveComponentRecord[]) : [];

	return {
		schemaVersion: TRACE_SCHEMA_VERSION,
		cycleId: typeof raw.cycleId === "string" && raw.cycleId.length > 0 ? raw.cycleId : createCycleId(raw.cycleNumber),
		cycleNumber: raw.cycleNumber,
		promptId: typeof raw.promptId === "string" ? raw.promptId : undefined,
		startedAt,
		endedAt,
		phaseTimestamps: parsePhaseTimestamps(raw.phaseTimestamps),
		depth: typeof raw.depth === "number" ? raw.depth : 0,
		taskPreview: typeof raw.taskPreview === "string" ? raw.taskPreview : "",
		phases: raw.phases,
		components,
		toolNames: parseToolNames(raw.toolNames),
		lawsVerdict: normalizeLawsVerdict(raw.lawsVerdict),
	};
}

export function parseCycleTraceFromEntry(entry: SessionEntry): ReflectiveCycleTrace | undefined {
	if (!isReflectiveCycleEntry(entry)) {
		return undefined;
	}
	return parseCycleTrace(entry.data, { fallbackTimestamp: entry.timestamp });
}

export interface BuildTraceCycleInput {
	cycleNumber: number;
	cycleId?: string;
	promptId?: string;
	startedAt: string;
	endedAt: string;
	phaseTimestamps: Partial<Record<ReflectivePhase, TracePhaseTimestamps>>;
	depth: number;
	taskPreview: string;
	phases: Record<ReflectivePhase, ReflectivePhaseRecord>;
	components: ReflectiveComponentRecord[];
	toolNames?: string[];
	lawsPre?: LawsVerdictRecord;
	lawsPost?: LawsVerdictRecord;
}

export function buildTraceCycleV1(input: BuildTraceCycleInput): ReflectiveCycleTrace {
	return {
		schemaVersion: TRACE_SCHEMA_VERSION,
		cycleId: input.cycleId ?? createCycleId(input.cycleNumber),
		cycleNumber: input.cycleNumber,
		promptId: input.promptId,
		startedAt: input.startedAt,
		endedAt: input.endedAt,
		phaseTimestamps: input.phaseTimestamps,
		depth: input.depth,
		taskPreview: input.taskPreview,
		phases: input.phases,
		components: input.components,
		toolNames: input.toolNames ?? [],
		lawsVerdict: { pre: input.lawsPre, post: input.lawsPost },
	};
}
