import { debugLog } from "../../utils/debug-log.ts";
import type { SessionManager } from "../session-manager.ts";
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
import { appendReflectiveCycleTrace, getReflectiveCycleCount } from "./session-trace.ts";
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

		// O — Observe (mandatory before act)
		const { observation, components: observerComponents } = runObserver(ctx);
		this.effortRegulator.recordObservation(true);
		components.push(...observerComponents);
		phases.observe = { phase: "observe", summary: observation.summary };

		// World model + focus (part of intend prep)
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
		const lawsVerdict = { allowed: policy.allowed, law: policy.law, reason: policy.reason };
		components.push(policyComponent(policy.allowed ? undefined : policy.reason));
		if (!policy.allowed) {
			phases.intend = {
				...phases.intend,
				blocked: true,
				blockReason: policy.reason,
			};
			const trace = this.buildTrace(cycleNumber, ctx, phases, components, lawsVerdict);
			appendReflectiveCycleTrace(this.sessionManager, trace);
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
			const trace = this.buildTrace(cycleNumber, ctx, phases, components, lawsVerdict);
			appendReflectiveCycleTrace(this.sessionManager, trace);
			throw new Error(phases.act.blockReason);
		}

		// A — Act (delegate to existing agent loop)
		await options.act();
		const actResult = summarizeAct(ctx, options.getMessageCount());
		this.effortRegulator.updateProgress(intention.summary, actResult.messageCountAfter > ctx.messageCount);
		phases.act = { phase: "act", summary: actResult.summary };

		// R — Reflect
		const { reflection, components: reflectComponents } = runReflect(ctx, "cycle", actResult.summary);
		components.push(...reflectComponents);
		phases.reflect = { phase: "reflect", summary: reflection.summary };

		const trace = this.buildTrace(cycleNumber, ctx, phases, components, lawsVerdict);
		appendReflectiveCycleTrace(this.sessionManager, trace);
		debugLog("reflective-loop", "cycle complete", { cycleNumber, promptId: ctx.promptId });
		return trace;
	}

	private buildTrace(
		cycleNumber: number,
		ctx: ReflectiveLoopContext,
		phases: Record<ReflectivePhase, ReflectivePhaseRecord>,
		components: ReflectiveComponentRecord[],
		lawsVerdict?: LawsVerdictRecord,
	): ReflectiveCycleTrace {
		return {
			cycleNumber,
			promptId: ctx.promptId,
			depth: ctx.depth,
			taskPreview: ctx.task.slice(0, 200),
			phases,
			components,
			lawsVerdict,
		};
	}
}
