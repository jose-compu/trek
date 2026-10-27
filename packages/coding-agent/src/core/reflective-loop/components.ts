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

const NEXT_ACTION = /\b(read|write|edit|bash|observe|reflect|spawn_subtask|next action)\b/i;

/** An intention names a next action when it mentions a tool or an explicit next action. */
export function intentionNamesNextAction(summary: string): boolean {
	return NEXT_ACTION.test(summary);
}

export function runIntentionFilter(intention: ReflectiveIntention): {
	intention: ReflectiveIntention;
	components: ReflectiveComponentRecord[];
} {
	const summary = intention.summary.trim();
	if (summary.length === 0) {
		return {
			intention: { ...intention, summary: `Repair: respond to user request (${intention.task.slice(0, 80)})` },
			components: [component("intentionFilter", "repaired empty intention")],
		};
	}
	if (!intentionNamesNextAction(summary)) {
		return {
			intention: { ...intention, summary: `${summary} Next action: use a tool.` },
			components: [component("intentionFilter", "repaired intention with no next action")],
		};
	}
	return {
		intention,
		components: [component("intentionFilter")],
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
