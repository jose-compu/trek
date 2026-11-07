/**
 * 0.18-B: domain lessons stay typed when roles climb.
 * Workhorse writes. Meta triggers live only on domains/meta/lessons.yaml.
 */

export const META_LAYER_TRIGGERS = [
	"misroute",
	"over_escalate",
	"over_think",
	"runner_miss",
	"verifier_reject",
	"budget_stop",
] as const;

export type MetaLayerTrigger = (typeof META_LAYER_TRIGGERS)[number];

export const LESSON_LAYER_ROLES = ["workhorse", "planning", "tooling", "frontier"] as const;
export type LessonLayerRole = (typeof LESSON_LAYER_ROLES)[number];

export function isLessonLayerRole(value: string): value is LessonLayerRole {
	return (LESSON_LAYER_ROLES as readonly string[]).includes(value);
}

export function detectMetaLessonTrigger(input: {
	task: string;
	correction?: string;
	layerWorkflow?: string;
	thinking?: string;
	action?: string;
	failures?: readonly string[];
	verifierDenied?: boolean;
	budgetStopped?: boolean;
}): MetaLayerTrigger | undefined {
	const hay = [input.task, input.correction, ...(input.failures ?? [])]
		.filter((part) => typeof part === "string" && part.length > 0)
		.join("\n")
		.toLowerCase();
	if (input.budgetStopped || /\bbudget[_ ]stop\b/.test(hay) || /\bcircuit breaker\b/.test(hay)) {
		return "budget_stop";
	}
	if (input.verifierDenied || /\bverifier reject/.test(hay)) {
		return "verifier_reject";
	}
	if (/\b(runner miss|missed grep)\b/.test(hay)) {
		return "runner_miss";
	}
	const needless = /\bover.?escalate\b/.test(hay) || /\b(needless climb|should have stayed on workhorse)\b/.test(hay);
	if (needless) {
		return "over_escalate";
	}
	if (/\bover.?think\b/.test(hay)) {
		return "over_think";
	}
	if (
		/\bmisroute\b/.test(hay) ||
		(input.action === "route" && /\b(wrong layer|should have (been|stayed|gone))\b/.test(hay))
	) {
		return "misroute";
	}
	return undefined;
}

/** Recall injects into the role about to act, not only the session preamble. */
export function tagRecallForRole(block: string, role: LessonLayerRole): string {
	if (!block.includes("<memory")) {
		return `<memory role="${role}">\n${block}\n</memory>`;
	}
	return retagRecallForRole(block, role);
}

/** Retarget an already-injected memory block when Archon or a climb changes the acting role. */
export function retagRecallForRole(prompt: string, role: LessonLayerRole): string {
	if (!prompt.includes("<memory")) {
		return prompt;
	}
	return prompt.replace(/<memory(?:\s+role="[^"]*")?>/g, `<memory role="${role}">`);
}

export function actingLessonRole(role: string | undefined): LessonLayerRole {
	if (role && isLessonLayerRole(role)) {
		return role;
	}
	return "workhorse";
}
