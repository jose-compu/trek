import type { AgentTool } from "@trek/agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { ResolvedRuntime } from "../runtime/resolve.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import type { ReflectiveLoopController } from "./loop-controller.ts";
import { runDepthFirstSubtask } from "./spawn-subtask.ts";

export const REFLECTIVE_META_TOOL_NAMES = ["observe", "reflect", "spawn_subtask"] as const;

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

	return [observeDefinition, reflectDefinition, spawnDefinition];
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
