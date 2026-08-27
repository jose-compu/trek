/**
 * Trek trace log (ROADMAP 0.6.0, SAFETY §9, REFLECTIVE §11).
 *
 * Schema v1 is the payload of session JSONL `customType: "trek:reflective_cycle"`.
 * One record per O→I→A→R cycle. Do not introduce a second loop or custom type.
 */

export {
	diffIntentionOutcome,
	findCycleTrace,
	forkLeafId,
	type IntentionOutcomeDiff,
	type LocatedCycleTrace,
	listCycleSummaries,
	locateCycleTraces,
} from "./query.ts";
export {
	COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE,
	type CounterfactualObserve,
	replayCounterfactual,
} from "./replay.ts";
export type {
	LawsVerdictPair,
	LawsVerdictRecord,
	ReflectiveCycleTrace,
	ReflectivePhase,
	TracePhaseTimestamps,
} from "./schema.ts";
export {
	type BuildTraceCycleInput,
	buildTraceCycleV1,
	createCycleId,
	isReflectiveCycleEntry,
	normalizeLawsVerdict,
	nowIso,
	type ParseCycleTraceOptions,
	parseCycleTrace,
	parseCycleTraceFromEntry,
	REFLECTIVE_CYCLE_CUSTOM_TYPE,
	TRACE_SCHEMA_VERSION,
} from "./schema.ts";
export {
	appendCycleCheckpoint,
	appendReflectiveCycleTrace,
	CYCLE_CHECKPOINT_CUSTOM_TYPE,
	type CycleCheckpoint,
	getLatestCycleCheckpoint,
	getReflectiveCycleCount,
	getReflectiveCycleTraces,
	persistCycleBoundary,
} from "./writer.ts";
