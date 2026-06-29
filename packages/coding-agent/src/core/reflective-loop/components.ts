import type {
	ReflectiveActResult,
	ReflectiveComponentId,
	ReflectiveComponentRecord,
	ReflectiveIntention,
	ReflectiveLoopContext,
	ReflectiveObservation,
	ReflectiveReflection,
} from "./types.ts";

function component(id: ReflectiveComponentId, note?: string): ReflectiveComponentRecord {
	return { id, invoked: true, note };
}

export function runWorldModel(ctx: ReflectiveLoopContext): {
	modelSummary: string;
	components: ReflectiveComponentRecord[];
} {
	const preview = ctx.task.trim().slice(0, 120);
	return {
		modelSummary: preview ? `Task scoped in ${ctx.cwd}: ${preview}` : `Task scoped in ${ctx.cwd}`,
		components: [component("worldModel")],
	};
}

export function runObserver(
	ctx: ReflectiveLoopContext,
	lastResultSummary?: string,
): { observation: ReflectiveObservation; components: ReflectiveComponentRecord[] } {
	return {
		observation: {
			summary: `Observed ${ctx.messageCount} messages in session at depth ${ctx.depth}`,
			messageCount: ctx.messageCount,
			cwd: ctx.cwd,
			lastResultSummary,
		},
		components: [component("observer")],
	};
}

export function runIntentionFilter(intention: ReflectiveIntention): {
	intention: ReflectiveIntention;
	components: ReflectiveComponentRecord[];
} {
	const valid = intention.summary.trim().length > 0;
	return {
		intention: valid
			? intention
			: { ...intention, summary: `Repair: respond to user request (${intention.task.slice(0, 80)})` },
		components: [component("intentionFilter", valid ? undefined : "repaired empty intention")],
	};
}

export function runOutputGuard(intention: ReflectiveIntention): {
	intention: ReflectiveIntention;
	components: ReflectiveComponentRecord[];
} {
	const sanitized = intention.summary.replace(/\bskip\s+all\s+safety\b/gi, "[redacted]");
	return {
		intention: { ...intention, summary: sanitized },
		components: [component("outputGuard")],
	};
}

export function runFocusManager(
	ctx: ReflectiveLoopContext,
	worldSummary: string,
): {
	focusSummary: string;
	components: ReflectiveComponentRecord[];
} {
	return {
		focusSummary: `Focus: depth ${ctx.depth}, ${worldSummary.slice(0, 80)}`,
		components: [component("focusManager")],
	};
}

export function buildIntention(ctx: ReflectiveLoopContext, _observation: ReflectiveObservation): ReflectiveIntention {
	const task = ctx.task.trim();
	return {
		summary: task ? `Intend to address: ${task.slice(0, 160)}` : "Intend to respond to user",
		task,
		requiresSubtasks: /\bsubtask\b|\bstep-by-step\b|\bdecompose\b/i.test(task),
	};
}

export function summarizeAct(ctx: ReflectiveLoopContext, messageCountAfter: number): ReflectiveActResult {
	return {
		summary: `Act phase delegated to agent (${messageCountAfter - ctx.messageCount} new messages)`,
		messageCountAfter,
	};
}

export function runReflect(
	_ctx: ReflectiveLoopContext,
	scope: string,
	actSummary: string,
): {
	reflection: ReflectiveReflection;
	components: ReflectiveComponentRecord[];
} {
	return {
		reflection: {
			scope,
			summary: `Reflect (${scope}): ${actSummary.slice(0, 120)}`,
		},
		components: [component("toolExecutor", "act delegated to existing agent loop")],
	};
}

export function policyComponent(note?: string): ReflectiveComponentRecord {
	return component("policyConstraints", note);
}

export function effortComponent(note?: string): ReflectiveComponentRecord {
	return component("effortRegulator", note);
}
