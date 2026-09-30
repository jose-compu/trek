/**
 * Coarse session role (issue #90). ComponentRouter is 0.9.0.
 * api: the configured session model, recorded as frontier.
 * local / hybrid: Act uses Work-horse. Plan/research uses Planning.
 * Frontier is the fourth layer only in hybrid.
 */

import type { ResolvedRuntime } from "./resolve.ts";
import type { RoleSource } from "./types.ts";

export const FRONTIER_COMPLEXITY_THRESHOLD = 0.7;

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
	if (wantsPlanning) {
		return fromRole(resolved, "planning", "plan or research step uses Planning");
	}
	return fromRole(resolved, "workhorse", "Act path uses Work-horse");
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
