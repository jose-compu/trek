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

/** Persisted once per user prompt cycle in session JSONL. */
export interface ReflectiveCycleTrace {
	cycleNumber: number;
	promptId?: string;
	depth: number;
	taskPreview: string;
	phases: Record<ReflectivePhase, ReflectivePhaseRecord>;
	components: ReflectiveComponentRecord[];
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
