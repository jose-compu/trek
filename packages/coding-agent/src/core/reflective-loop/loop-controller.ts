import { debugLog } from "../../utils/debug-log.ts";
import type { SessionManager } from "../session-manager.ts";
import {
	buildTraceCycleV1,
	createCycleId,
	getReflectiveCycleCount,
	nowIso,
	persistCycleBoundary,
} from "../trace/index.ts";
import {
	buildIntention,
	effortComponent,
	policyComponent,
	runFocusManager,
	runIntentionFilter,
	runObserver,
	runOutputGuard,
	runReflect,
	runWorldModel,
	summarizeAct,
} from "./components.ts";
import { EffortRegulator } from "./effort-regulator.ts";
import { checkPolicyConstraints } from "./policy-constraints.ts";
import { SubtaskStack } from "./subtask-stack.ts";
import type {
	LawsVerdictRecord,
	ReflectiveComponentRecord,
	ReflectiveCycleTrace,
	ReflectiveLoopContext,
	ReflectiveObservation,
	ReflectivePhase,
	ReflectivePhaseRecord,
	ReflectiveReflection,
	TracePhaseTimestamps,
} from "./types.ts";

export interface RunPromptCycleOptions {
	task: string;
	promptId?: string;
	cwd: string;
	messageCount: number;
	/** Run the existing agent LLM + tool loop (Act phase). */
	act: () => Promise<void>;
	getMessageCount: () => number;
	requireDestructiveConfirm?: boolean;
	/** Tool names invoked during Act (filled by AgentSession afterToolCall). */
	getToolNames?: () => string[];
	/** Aggregated post-flight laws verdict after Act tools. */
	getPostFlightVerdict?: () => LawsVerdictRecord | undefined;
}

export class ReflectiveLoopController {
	private effortRegulator = new EffortRegulator();
	private subtaskStack = new SubtaskStack();
	private sessionManager: SessionManager;

	constructor(sessionManager: SessionManager) {
		this.sessionManager = sessionManager;
	}

	get effort(): EffortRegulator {
		return this.effortRegulator;
	}

	get subtasks(): SubtaskStack {
		return this.subtaskStack;
	}

	/** Meta-tool: observe() — re-read state without mutating. */
	observe(ctx: Omit<ReflectiveLoopContext, "depth">): ReflectiveObservation {
		const fullCtx: ReflectiveLoopContext = { ...ctx, depth: this.subtaskStack.depth };
		const { observation } = runObserver(fullCtx);
		this.effortRegulator.recordObservation(true);
		debugLog("reflective-loop", "observe", observation);
		return observation;
	}

	/** Meta-tool: reflect(scope) — structured post-hoc reflection. */
	reflect(
		scope: string,
		ctx: Omit<ReflectiveLoopContext, "depth">,
		actSummary = "manual reflect",
	): ReflectiveReflection {
		const fullCtx: ReflectiveLoopContext = { ...ctx, depth: this.subtaskStack.depth };
		const { reflection } = runReflect(fullCtx, scope, actSummary);
		debugLog("reflective-loop", "reflect", { scope, summary: reflection.summary });
		return reflection;
	}

	async runPromptCycle(options: RunPromptCycleOptions): Promise<ReflectiveCycleTrace> {
		const cycleNumber = getReflectiveCycleCount(this.sessionManager) + 1;
		const cycleId = createCycleId(cycleNumber);
		const startedAt = nowIso();
		const phaseTimestamps: Partial<Record<ReflectivePhase, TracePhaseTimestamps>> = {};
		const ctx: ReflectiveLoopContext = {
			task: options.task,
			promptId: options.promptId,
			cwd: options.cwd,
			messageCount: options.messageCount,
			depth: this.subtaskStack.depth,
		};

		const components: ReflectiveComponentRecord[] = [];
		const phases: Record<ReflectivePhase, ReflectivePhaseRecord> = {
			observe: { phase: "observe", summary: "" },
			intend: { phase: "intend", summary: "" },
			act: { phase: "act", summary: "" },
			reflect: { phase: "reflect", summary: "" },
		};

		const markPhase = (phase: ReflectivePhase): { end: () => void } => {
			const phaseStarted = nowIso();
			return {
				end: () => {
					phaseTimestamps[phase] = { startedAt: phaseStarted, endedAt: nowIso() };
				},
			};
		};

		// O — Observe (mandatory before act)
		const observeMark = markPhase("observe");
		const { observation, components: observerComponents } = runObserver(ctx);
		this.effortRegulator.recordObservation(true);
		components.push(...observerComponents);
		phases.observe = { phase: "observe", summary: observation.summary };
		observeMark.end();

		// World model + focus (part of intend prep)
		const intendMark = markPhase("intend");
		const { modelSummary, components: worldComponents } = runWorldModel(ctx);
		components.push(...worldComponents);
		const { focusSummary, components: focusComponents } = runFocusManager(ctx, modelSummary);
		components.push(...focusComponents);

		// I — Intend
		let intention = buildIntention(ctx, observation);
		const filtered = runIntentionFilter(intention);
		intention = filtered.intention;
		components.push(...filtered.components);
		const guarded = runOutputGuard(intention);
		intention = guarded.intention;
		components.push(...guarded.components);
		phases.intend = {
			phase: "intend",
			summary: `${modelSummary}; ${focusSummary}; ${intention.summary}`,
		};

		// Laws / policy gate (issue #3: PolicyConstraints and Laws are one implementation)
		const policy = checkPolicyConstraints(options.task, options.requireDestructiveConfirm);
		const lawsPre: LawsVerdictRecord = { allowed: policy.allowed, law: policy.law, reason: policy.reason };
		components.push(policyComponent(policy.allowed ? undefined : policy.reason));
		intendMark.end();
		if (!policy.allowed) {
			phases.intend = {
				...phases.intend,
				blocked: true,
				blockReason: policy.reason,
			};
			const trace = this.buildTrace({
				cycleNumber,
				cycleId,
				ctx,
				phases,
				components,
				phaseTimestamps,
				startedAt,
				lawsPre,
			});
			persistCycleBoundary(this.sessionManager, trace);
			throw new Error(policy.reason ?? "Blocked by policy constraints.");
		}

		// Effort regulator gate
		components.push(effortComponent());
		if (!this.effortRegulator.shouldContinue()) {
			phases.act = {
				phase: "act",
				summary: "Act skipped",
				skipped: true,
				blockReason: "EffortRegulator blocked act (observation skipped or loop detected).",
			};
			const trace = this.buildTrace({
				cycleNumber,
				cycleId,
				ctx,
				phases,
				components,
				phaseTimestamps,
				startedAt,
				lawsPre,
			});
			persistCycleBoundary(this.sessionManager, trace);
			throw new Error(phases.act.blockReason);
		}

		// A — Act (delegate to existing agent loop)
		const actMark = markPhase("act");
		await options.act();
		const actResult = summarizeAct(ctx, options.getMessageCount());
		this.effortRegulator.updateProgress(intention.summary, actResult.messageCountAfter > ctx.messageCount);
		phases.act = { phase: "act", summary: actResult.summary };
		actMark.end();

		// R — Reflect
		const reflectMark = markPhase("reflect");
		const { reflection, components: reflectComponents } = runReflect(ctx, "cycle", actResult.summary);
		components.push(...reflectComponents);
		phases.reflect = { phase: "reflect", summary: reflection.summary };
		reflectMark.end();

		const trace = this.buildTrace({
			cycleNumber,
			cycleId,
			ctx,
			phases,
			components,
			phaseTimestamps,
			startedAt,
			lawsPre,
			lawsPost: options.getPostFlightVerdict?.(),
			toolNames: options.getToolNames?.() ?? [],
		});
		persistCycleBoundary(this.sessionManager, trace);
		debugLog("reflective-loop", "cycle complete", { cycleNumber, cycleId, promptId: ctx.promptId });
		return trace;
	}

	private buildTrace(args: {
		cycleNumber: number;
		cycleId: string;
		ctx: ReflectiveLoopContext;
		phases: Record<ReflectivePhase, ReflectivePhaseRecord>;
		components: ReflectiveComponentRecord[];
		phaseTimestamps: Partial<Record<ReflectivePhase, TracePhaseTimestamps>>;
		startedAt: string;
		lawsPre?: LawsVerdictRecord;
		lawsPost?: LawsVerdictRecord;
		toolNames?: string[];
	}): ReflectiveCycleTrace {
		return buildTraceCycleV1({
			cycleNumber: args.cycleNumber,
			cycleId: args.cycleId,
			promptId: args.ctx.promptId,
			startedAt: args.startedAt,
			endedAt: nowIso(),
			phaseTimestamps: args.phaseTimestamps,
			depth: args.ctx.depth,
			taskPreview: args.ctx.task.slice(0, 200),
			phases: args.phases,
			components: args.components,
			toolNames: args.toolNames ?? [],
			lawsPre: args.lawsPre,
			lawsPost: args.lawsPost,
		});
	}
}
