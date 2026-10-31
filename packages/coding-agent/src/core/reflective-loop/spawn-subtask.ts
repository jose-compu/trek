/**
 * Depth-first subtask. The child sees the parent summary only.
 * Routing uses the component router so the child step names a model.
 */

import type { ResolvedRuntime } from "../runtime/resolve.ts";
import { type RoleSelection, selectSessionRole } from "../runtime/select-role.ts";
import type { SubtaskStack } from "./subtask-stack.ts";

export interface DepthFirstSubtaskInput {
	description: string;
	/** Parent handoff. The child does not receive the full transcript. */
	summary: string;
	resolved: ResolvedRuntime;
	/** Nested work runs before this frame is popped. */
	runChild?: () => void;
}

export interface DepthFirstSubtaskResult {
	depth: number;
	context: "summary_only";
	summary: string;
	role: RoleSelection["role"];
	modelId: string;
	reason: string;
}

export function runDepthFirstSubtask(stack: SubtaskStack, input: DepthFirstSubtaskInput): DepthFirstSubtaskResult {
	stack.push({ description: input.description, parentSummary: input.summary });
	try {
		input.runChild?.();
		const route = selectSessionRole({ text: input.description, resolved: input.resolved });
		return {
			depth: stack.depth,
			context: "summary_only",
			summary: input.summary,
			role: route.role,
			modelId: route.modelId,
			reason: route.reason,
		};
	} finally {
		stack.pop();
	}
}
