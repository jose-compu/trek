/**
 * Session routing uses routeComponent. Workhorse acts. Planning thinks.
 * Frontier (API) takes deep thinking, planning, and hard debugging when present.
 * api mode keeps a single session model.
 */

import { routeComponent } from "./component-router.ts";
import type { ResolvedRuntime } from "./resolve.ts";
import type { RoleSource, RouteComponent } from "./types.ts";

export const FRONTIER_COMPLEXITY_THRESHOLD = 0.7;

/** A from-scratch or multi-step task. */
const HARD_TASK =
	/\b(build|create|implement|scaffold|website|game|app|application|design|architect|refactor|rewrite|project)\b/i;

/** "make/write/code a chess game" does not contain the hard-task nouns above. */
const MAKE_ARTIFACT =
	/\b(make|write|code|develop)\b[\s\S]{0,80}\b(app|game|site|website|page|server|api|program|project|chess|html|javascript|script|tool)\b/i;

/** A one-line correction stays on the workhorse, including after a Planning turn. */
const SMALL_EDIT = /\b(typo|format|lint|rename|spell(?:ing)?)\b/i;

const DEEP_WORK =
	/\b(debug|diagnos|root[- ]cause|hard bug|investigate|architect(?:ure)?|deep (?:think|plan|dive)|research)\b/i;

export type TaskKind = "mechanical" | "act" | "plan" | "deep";

export interface TaskClass {
	kind: TaskKind;
	component: RouteComponent;
	complexity: number;
}

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

export function classifyTask(text: string): TaskClass {
	const trimmed = text.trim();
	if (isSmallEdit(trimmed)) {
		return { kind: "mechanical", component: "mechanical", complexity: 0.1 };
	}
	if (/(?:^|\s)\/frontier\b/i.test(trimmed) || DEEP_WORK.test(trimmed)) {
		return { kind: "deep", component: "intend", complexity: 0.85 };
	}
	if (/\b(plan|planning|research)\b/i.test(trimmed) || promptNeedsPlanning(trimmed)) {
		return { kind: "plan", component: "intend", complexity: 0.4 };
	}
	return { kind: "act", component: "toolIntent", complexity: 0.2 };
}

export interface RoleSelection {
	role: "workhorse" | "planning" | "frontier";
	source: RoleSource;
	modelId: string;
	provider?: string;
	thinking: boolean;
	reason: string;
}

export function selectThinkRole(input: {
	text: string;
	resolved: ResolvedRuntime;
	complexity?: number;
	retries?: number;
	previousRole?: RoleSelection["role"];
	overrides?: Parameters<typeof routeComponent>[0]["overrides"];
}): RoleSelection | undefined {
	if (input.resolved.effectiveMode === "api") {
		return undefined;
	}
	const classified = classifyTask(input.text ?? "");
	let kind = classified.kind;
	if (input.previousRole === "frontier" && (input.text ?? "").trim().length > 0 && kind !== "mechanical") {
		kind = "deep";
	} else if (input.previousRole === "planning" && (input.text ?? "").trim().length > 0 && kind !== "mechanical") {
		kind = kind === "deep" ? "deep" : "plan";
	}
	if (kind === "mechanical" || kind === "act") {
		return undefined;
	}
	const complexity = input.complexity ?? (kind === "deep" ? 0.85 : Math.max(classified.complexity, 0.4));
	return routeComponent({
		component: "intend",
		resolved: input.resolved,
		complexity,
		retries: input.retries ?? 0,
		depth: 0,
		overrides: input.overrides,
	});
}

export function selectSessionRole(input: {
	text: string;
	resolved: ResolvedRuntime;
	complexity?: number;
	retries?: number;
	/** The role already bound for this session. A follow-up stays on a Planning task. */
	previousRole?: RoleSelection["role"];
	overrides?: Parameters<typeof routeComponent>[0]["overrides"];
}): RoleSelection {
	const { resolved } = input;
	if (resolved.effectiveMode === "api") {
		return routeComponent({
			component: "toolIntent",
			resolved,
		});
	}

	const text = input.text ?? "";
	const classified = classifyTask(text);
	let kind = classified.kind;
	if (input.previousRole === "frontier" && text.trim().length > 0 && kind !== "mechanical") {
		kind = "deep";
	} else if (input.previousRole === "planning" && text.trim().length > 0 && kind !== "mechanical") {
		kind = kind === "deep" ? "deep" : "plan";
	}

	const complexity =
		input.complexity ??
		(kind === "deep" ? 0.85 : kind === "plan" ? Math.max(classified.complexity, 0.4) : classified.complexity);

	if (kind === "deep") {
		return routeComponent({
			component: "intend",
			resolved,
			complexity,
			retries: input.retries ?? 0,
			depth: 0,
			overrides: input.overrides,
		});
	}
	if (kind === "plan") {
		return routeComponent({
			component: "toolIntent",
			resolved,
			complexity,
			retries: input.retries ?? 0,
			depth: 1,
			overrides: input.overrides,
		});
	}
	return routeComponent({
		component: classified.component,
		resolved,
		complexity,
		retries: input.retries ?? 0,
		depth: 1,
		overrides: input.overrides,
	});
}

/** Map the bound chat model back to its suite role. */
export function sessionRoleForModel(
	resolved: ResolvedRuntime,
	model: { provider?: string; id?: string; name?: string } | undefined,
): RoleSelection["role"] | undefined {
	if (!model || (model.provider !== "local" && model.provider !== "lmstudio")) {
		if (model?.provider && model.provider !== "local") {
			return resolved.roles.frontier ? "frontier" : undefined;
		}
		return undefined;
	}
	for (const role of ["planning", "workhorse"] as const) {
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
