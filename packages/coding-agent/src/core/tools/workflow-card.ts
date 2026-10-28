import { Text } from "@trek/tui";
import { Type } from "typebox";
import type { Theme, ThemeColor } from "../../modes/interactive/theme/theme.ts";
import type { FilledParameter } from "../domains/parameters.ts";
import type { ToolDefinition } from "../extensions/types.ts";

export interface WorkflowCallArgs {
	domain: string;
	workflow: string;
	reason: string;
	parameters: FilledParameter[];
	nodes: string[];
}

const schema = Type.Object({
	domain: Type.String(),
	workflow: Type.String(),
	reason: Type.String(),
	parameters: Type.Array(
		Type.Object({
			name: Type.String(),
			kind: Type.String(),
			value: Type.String(),
		}),
	),
	nodes: Type.Array(Type.String()),
});

export function formatWorkflowCall(args: WorkflowCallArgs, theme: Theme): string {
	const title = typeof theme.bold === "function" ? theme.bold("workflow") : "workflow";
	const lines = [
		`${theme.fg("success", title)}  ${theme.fg("success", args.domain)}${theme.fg("dim", "/")} ${theme.fg("mdLink", args.workflow)}  ${theme.fg("muted", args.reason)}`,
	];
	for (const parameter of args.parameters) {
		const color: ThemeColor = parameter.kind === "number" ? "syntaxNumber" : "syntaxString";
		lines.push(`  ${theme.fg("syntaxKeyword", parameter.name)}  ${theme.fg(color, parameter.value)}`);
	}
	if (args.nodes.length > 0) {
		lines.push(`  ${theme.fg("muted", "nodes")}  ${theme.fg("syntaxFunction", args.nodes.join(" → "))}`);
	}
	return lines.join("\n");
}

function readArgs(args: unknown): WorkflowCallArgs {
	const record = args && typeof args === "object" ? (args as Partial<WorkflowCallArgs>) : {};
	const parameters = Array.isArray(record.parameters) ? record.parameters : [];
	return {
		domain: String(record.domain ?? ""),
		workflow: String(record.workflow ?? ""),
		reason: String(record.reason ?? ""),
		parameters: parameters
			.filter((row) => row && typeof row === "object")
			.map(
				(row): FilledParameter => ({
					name: String(row.name ?? ""),
					kind: row.kind === "number" ? "number" : "text",
					value: String(row.value ?? ""),
				}),
			)
			.filter((row) => row.name.length > 0 && row.value.length > 0),
		nodes: Array.isArray(record.nodes) ? record.nodes.map((node) => String(node)) : [],
	};
}

/** Display-only. The session emits the call when a domain matches. The model does not see this tool. */
export const workflowToolDefinition: ToolDefinition = {
	name: "workflow",
	label: "workflow",
	description: "Shows the domain workflow detected for this turn.",
	parameters: schema,
	execute: async (_id, params) => {
		const args = readArgs(params);
		const lines = args.parameters.map((parameter) => `${parameter.name}: ${parameter.value}`);
		return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
	},
	renderCall(args, theme, context) {
		const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		text.setText(formatWorkflowCall(readArgs(args), theme));
		return text;
	},
};
