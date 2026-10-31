/**
 * Coarse session role (issue #90). Per-component assignment is routeComponent.
 * api: the configured session model, recorded as frontier.
 * local / hybrid: Act uses Workhorse. Plan/research uses Planning.
 * Frontier is the fourth layer only in hybrid.
 */

import type { ResolvedRuntime } from "./resolve.ts";
import type { RoleSource } from "./types.ts";

export const FRONTIER_COMPLEXITY_THRESHOLD = 0.7;

/** A from-scratch or multi-step task. The tooling model is never the session model. */
const HARD_TASK =
	/\b(build|create|implement|scaffold|website|game|app|application|design|architect|refactor|rewrite|project)\b/i;

/** "make/write/code a chess game" does not contain the hard-task nouns above. */
const MAKE_ARTIFACT =
	/\b(make|write|code|develop)\b[\s\S]{0,80}\b(app|game|site|website|page|server|api|program|project|chess|html|javascript|script|tool)\b/i;

/** A one-line correction stays on the workhorse, including after a Planning turn. */
const SMALL_EDIT = /\b(typo|format|lint|rename|spell(?:ing)?)\b/i;

export function isSmallEdit(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || !SMALL_EDIT.test(trimmed)) {
		return false;
	}
	return !/\b(build|create|implement|scaffold)\b/i.test(trimmed);
}

export function promptNeedsPlanning(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || isSmallEdit(trimmed)) {
		return false;
	}
	if (HARD_TASK.test(trimmed) || MAKE_ARTIFACT.test(trimmed)) {
		return true;
	}
	return trimmed.length >= 400 && /\b(file|files|html|javascript|css|function|component|page)\b/i.test(trimmed);
}

export interface RoleSelection {
	role: "tooling" | "workhorse" | "planning" | "frontier";
	source: RoleSource;
	modelId: string;
	provider?: string;
	thinking: boolean;
	reason: string;
}

export function selectSessionRole(input: {
	text: string;
	resolved: ResolvedRuntime;
	complexity?: number;
	/** The role already bound for this session. A follow-up stays on Planning. */
	previousRole?: RoleSelection["role"];
}): RoleSelection {
	const { resolved } = input;
	if (resolved.effectiveMode === "api") {
		return fromRole(resolved, "frontier", "api mode uses the configured session model");
	}

	const text = input.text ?? "";
	const complexity = input.complexity ?? 0;
	const wantsFrontier = /(?:^|\s)\/frontier\b/i.test(text) || complexity > FRONTIER_COMPLEXITY_THRESHOLD;
	const wantsPlanning = /\b(plan|planning|research)\b/i.test(text);
	const planning = resolved.roles.planning;

	if (wantsFrontier && resolved.effectiveMode === "hybrid" && resolved.roles.frontier) {
		return fromRole(resolved, "frontier", "hybrid Frontier layer for a heavier step");
	}
	if (wantsFrontier && resolved.effectiveMode === "local") {
		if (planning) {
			return fromRole(resolved, "planning", "frontier is not available in local mode; using Planning");
		}
	}
	if (!planning) {
		return fromRole(resolved, "workhorse", "Planning is missing; Work-horse is the fallback");
	}
	if (isSmallEdit(text)) {
		return fromRole(resolved, "workhorse", "a small edit uses Work-horse");
	}
	if (wantsPlanning) {
		return fromRole(resolved, "planning", "plan or research step uses Planning");
	}
	if (promptNeedsPlanning(text)) {
		return fromRole(resolved, "planning", "building uses Planning");
	}
	if (input.previousRole === "planning" && text.trim().length > 0) {
		return fromRole(resolved, "planning", "continuing a Planning task");
	}
	return fromRole(resolved, "workhorse", "Act path uses Work-horse");
}

/** Map the bound local chat model back to its suite role. Tooling is not a session default. */
export function sessionRoleForModel(
	resolved: ResolvedRuntime,
	model: { provider?: string; id?: string; name?: string } | undefined,
): RoleSelection["role"] | undefined {
	if (!model || model.provider !== "local") {
		return undefined;
	}
	for (const role of ["planning", "workhorse", "tooling"] as const) {
		const id = resolved.roles[role]?.id;
		if (!id) {
			continue;
		}
		if (model.name === id || model.id === id || model.id?.endsWith(`/${id}`) || model.id?.endsWith(`${id}.gguf`)) {
			return role;
		}
	}
	return undefined;
}

export function latestUserPrompt(messages: readonly { role: string; content?: unknown }[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") {
			continue;
		}
		return contentText(message.content);
	}
	return "";
}

function fromRole(resolved: ResolvedRuntime, role: RoleSelection["role"], reason: string): RoleSelection {
	const assignment = resolved.roles[role];
	if (!assignment) {
		throw new Error(`Role ${role} is not assigned.`);
	}
	const selection: RoleSelection = {
		role,
		source: assignment.source,
		modelId: assignment.id,
		thinking: assignment.thinking,
		reason,
	};
	if (assignment.provider) {
		selection.provider = assignment.provider;
	}
	return selection;
}

function contentText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
				return part.text;
			}
			return "";
		})
		.join("\n");
}
