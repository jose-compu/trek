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
	layerWorkflow?: string;
	thinking?: string;
	action?: string;
}): MetaLayerTrigger | undefined {
	const hay = input.task.toLowerCase();
	if (input.layerWorkflow === "layer-budget-stop" || /\bbudget stop\b/.test(hay)) {
		return "budget_stop";
	}
	if (input.layerWorkflow === "layer-verify" || /\bverifier reject/.test(hay)) {
		return "verifier_reject";
	}
	if (input.layerWorkflow === "layer-tool-runners" && /\b(runner miss|missed grep)\b/.test(hay)) {
		return "runner_miss";
	}
	if (input.action === "escalate" || input.layerWorkflow === "layer-escalate" || /\bescalate\b/.test(hay)) {
		if (/\b(typo|rename|one.line|should have stayed on workhorse)\b/.test(hay)) {
			return "over_escalate";
		}
	}
	if (/\bover.?escalate\b/.test(hay)) {
		return "over_escalate";
	}
	if (input.thinking === "deep" && /\b(one.line|typo|trivial)\b/.test(hay)) {
		return "over_think";
	}
	if (/\bover.?think\b/.test(hay)) {
		return "over_think";
	}
	if (/\bmisroute\b/.test(hay)) {
		return "misroute";
	}
	return undefined;
}

/** Recall injects into the role about to act, not only the session preamble. */
export function tagRecallForRole(block: string, role: LessonLayerRole): string {
	if (!block.includes("<memory>")) {
		return `<memory role="${role}">\n${block}\n</memory>`;
	}
	return block.replace("<memory>", `<memory role="${role}">`);
}

export function actingLessonRole(role: string | undefined): LessonLayerRole {
	if (role && isLessonLayerRole(role)) {
		return role;
	}
	return "workhorse";
}
