import type { AgentTool } from "@trek/agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "../tools/tool-definition-wrapper.ts";
import type { ReflectiveLoopController } from "./loop-controller.ts";

export const REFLECTIVE_META_TOOL_NAMES = ["observe", "reflect"] as const;

const observeSchema = Type.Object({});

const reflectSchema = Type.Object({
	scope: Type.String({ description: "Reflection scope (e.g. cycle, subtask, session)" }),
});

export function createReflectiveMetaToolDefinitions(
	controller: ReflectiveLoopController,
	cwd: string,
	getMessageCount: () => number,
	getLastTask: () => string,
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

	return [observeDefinition, reflectDefinition];
}

export function createReflectiveMetaTools(
	controller: ReflectiveLoopController,
	cwd: string,
	getMessageCount: () => number,
	getLastTask: () => string,
): AgentTool[] {
	return createReflectiveMetaToolDefinitions(controller, cwd, getMessageCount, getLastTask).map((definition) =>
		wrapToolDefinition(definition),
	);
}
