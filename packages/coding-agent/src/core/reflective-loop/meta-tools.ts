import type { AgentTool } from "@trek/agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { ResolvedRuntime } from "../runtime/resolve.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import { type BranchInput, type BranchResult, formatBranchResults, MAX_BREADTH } from "./branches.ts";
import type { ReflectiveLoopController } from "./loop-controller.ts";
import { runDepthFirstSubtask } from "./spawn-subtask.ts";

export const REFLECTIVE_META_TOOL_NAMES = ["observe", "reflect", "spawn_subtask", "spawn_branches", "gather"] as const;

/** A branch does not spawn again. */
export const BRANCH_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set(["spawn_subtask", "spawn_branches", "gather"]);

export interface BranchRunner {
	spawn(subtasks: BranchInput[], signal?: AbortSignal): Promise<BranchResult[]>;
	gather(ids: string[]): string;
}

const branchesSchema = Type.Object({
	subtasks: Type.Array(
		Type.Object({
			description: Type.String({ description: "What this branch must do" }),
			summary: Type.Optional(Type.String({ description: "Parent summary handed to this branch" })),
		}),
		{ description: `Independent subtasks, at most ${MAX_BREADTH}. They run in parallel.` },
	),
});

const gatherSchema = Type.Object({
	subtask_ids: Type.Array(Type.String(), { description: "Branch ids returned by spawn_branches" }),
});

const observeSchema = Type.Object({});

const reflectSchema = Type.Object({
	scope: Type.String({ description: "Reflection scope (e.g. cycle, subtask, session)" }),
});

const spawnSchema = Type.Object({
	description: Type.String({ description: "What the child subtask must do" }),
	summary: Type.Optional(
		Type.String({ description: "Parent summary handed to the child. Full transcript is not passed." }),
	),
});

export function createReflectiveMetaToolDefinitions(
	controller: ReflectiveLoopController,
	cwd: string,
	getMessageCount: () => number,
	getLastTask: () => string,
	getResolved: () => ResolvedRuntime,
	branches?: BranchRunner,
): ToolDefinition[] {
	const observeDefinition: ToolDefinition = {
		name: "observe",
		label: "observe",
		description: "Re-read the current session state without taking action (reflective loop meta-tool).",
		parameters: observeSchema,
		execute: async () => {
			const observation = controller.observe({
				task: getLastTask(),
				cwd,
				messageCount: getMessageCount(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(observation, null, 2) }],
				details: observation,
			};
		},
	};

	const reflectDefinition: ToolDefinition = {
		name: "reflect",
		label: "reflect",
		description: "Force a structured reflection for the given scope (reflective loop meta-tool).",
		parameters: reflectSchema,
		execute: async (_toolCallId, input: { scope: string }) => {
			const reflection = controller.reflect(input.scope, {
				task: getLastTask(),
				cwd,
				messageCount: getMessageCount(),
			});
			return {
				content: [{ type: "text", text: JSON.stringify(reflection, null, 2) }],
				details: reflection,
			};
		},
	};

	const spawnDefinition: ToolDefinition = {
		name: "spawn_subtask",
		label: "spawn_subtask",
		description: "Run a child step depth-first. The child receives the parent summary only.",
		parameters: spawnSchema,
		execute: async (_toolCallId, input: { description: string; summary?: string }) => {
			const summary = input.summary?.trim() || input.description;
			try {
				const result = runDepthFirstSubtask(controller.subtasks, {
					description: input.description,
					summary,
					resolved: getResolved(),
				});
				return {
					content: [
						{
							type: "text",
							text: `summary_only depth ${result.depth}: ${result.summary} (${result.role} ${result.modelId})`,
						},
					],
					details: result,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: message }],
					details: { error: message },
					isError: true,
				};
			}
		},
	};

	if (!branches) return [observeDefinition, reflectDefinition, spawnDefinition];

	const branchesDefinition: ToolDefinition = {
		name: "spawn_branches",
		label: "spawn_branches",
		description: `Run up to ${MAX_BREADTH} independent subtasks in parallel. Each branch gets its summary only and the same tools and laws. Returns each branch summary.`,
		parameters: branchesSchema,
		// Each call inside a branch passes the parent gate.
		reversibilityTier: "free",
		execute: async (_toolCallId, input: { subtasks: BranchInput[] }, signal) => {
			const results = await branches.spawn(input.subtasks ?? [], signal);
			return {
				content: [{ type: "text", text: formatBranchResults(results) }],
				details: { branches: results },
			};
		},
	};

	const gatherDefinition: ToolDefinition = {
		name: "gather",
		label: "gather",
		description: "Merge the summaries of earlier branches, in the order given.",
		parameters: gatherSchema,
		reversibilityTier: "free",
		execute: async (_toolCallId, input: { subtask_ids: string[] }) => {
			const text = branches.gather(input.subtask_ids ?? []);
			return { content: [{ type: "text", text }], details: { ids: input.subtask_ids } };
		},
	};

	return [observeDefinition, reflectDefinition, spawnDefinition, branchesDefinition, gatherDefinition];
}

export function createReflectiveMetaTools(
	controller: ReflectiveLoopController,
	cwd: string,
	getMessageCount: () => number,
	getLastTask: () => string,
	getResolved: () => ResolvedRuntime,
): AgentTool[] {
	return createReflectiveMetaToolDefinitions(controller, cwd, getMessageCount, getLastTask, getResolved).map(
		(definition) => wrapToolDefinition(definition),
	);
}
