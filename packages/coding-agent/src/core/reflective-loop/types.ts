/** Reflective agent loop phases (O→I→A→R). */
export type ReflectivePhase = "observe" | "intend" | "act" | "reflect";

/** Eight reflective components from SPECS_REFLECTIVE_AGENT §2. */
export type ReflectiveComponentId =
	| "worldModel"
	| "intentionFilter"
	| "outputGuard"
	| "toolExecutor"
	| "policyConstraints"
	| "effortRegulator"
	| "observer"
	| "focusManager";

export interface ReflectivePhaseRecord {
	phase: ReflectivePhase;
	summary: string;
	blocked?: boolean;
	blockReason?: string;
	skipped?: boolean;
}

export interface ReflectiveComponentRecord {
	id: ReflectiveComponentId;
	invoked: boolean;
	note?: string;
}

/** Result of the Laws/policy gate for one cycle (issue #3: single loop, laws in trace). */
export interface LawsVerdictRecord {
	allowed: boolean;
	law?: number;
	reason?: string;
}

/** Pre-flight (Intend→Act) and post-flight (after Act tools) laws results. */
export interface LawsVerdictPair {
	pre?: LawsVerdictRecord;
	post?: LawsVerdictRecord;
}

export interface TracePhaseTimestamps {
	startedAt: string;
	endedAt?: string;
}

/** JSONL payload schema version for `trek:reflective_cycle` (0.6.0 Trace). */
export const TRACE_SCHEMA_VERSION = 1 as const;
export type TraceSchemaVersion = typeof TRACE_SCHEMA_VERSION;

/**
 * Persisted once per user prompt cycle in session JSONL (`customType: trek:reflective_cycle`).
 * Schema v1: timestamps, cycle id, tool names, laws pre/post.
 */
export interface ReflectiveCycleTrace {
	schemaVersion: TraceSchemaVersion;
	cycleId: string;
	cycleNumber: number;
	promptId?: string;
	startedAt: string;
	endedAt: string;
	phaseTimestamps: Partial<Record<ReflectivePhase, TracePhaseTimestamps>>;
	depth: number;
	taskPreview: string;
	phases: Record<ReflectivePhase, ReflectivePhaseRecord>;
	components: ReflectiveComponentRecord[];
	toolNames: string[];
	lawsVerdict: LawsVerdictPair;
}

export interface ReflectiveObservation {
	summary: string;
	messageCount: number;
	cwd: string;
	lastResultSummary?: string;
}

export interface ReflectiveIntention {
	summary: string;
	task: string;
	requiresSubtasks: boolean;
}

export interface ReflectiveActResult {
	summary: string;
	messageCountAfter: number;
}

export interface ReflectiveReflection {
	summary: string;
	scope: string;
}

export interface PolicyCheckResult {
	allowed: boolean;
	reason?: string;
	/** The law (0-3) that produced a block, when `allowed` is false. */
	law?: number;
}

export interface ReflectiveLoopContext {
	task: string;
	promptId?: string;
	cwd: string;
	messageCount: number;
	depth: number;
}

export const REFLECTIVE_CYCLE_CUSTOM_TYPE = "trek:reflective_cycle";
export const DEFAULT_MAX_SUBTASK_DEPTH = 5;
