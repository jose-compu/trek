/**
 * A prompt that creates, edits, or restores a domain workflow.
 * The file write happens only after the YAML parses.
 */

import { parseArchonWorkflow } from "./archon.ts";

export interface WorkflowEditRequest {
	kind: "create" | "edit" | "restore";
	id: string;
	instruction: string;
}

const ID = "([a-z][a-z0-9-]{0,40})";
const CREATE = new RegExp(
	`^(?:please\\s+)?(?:create|add|make)\\s+(?:a\\s+)?(?:new\\s+)?(?:domain\\s+)?workflow\\s+(?:for|called|named)\\s+${ID}\\b[\\s,:.-]*(.*)$`,
	"is",
);
const EDIT = new RegExp(
	`^(?:please\\s+)?(?:edit|change|update)\\s+(?:the\\s+)?${ID}\\s+workflow\\b[\\s,:.-]*(.*)$`,
	"is",
);
const RESTORE = new RegExp(
	`^(?:please\\s+)?(?:restore|revert|undo)\\s+(?:the\\s+)?(?:previous\\s+)?${ID}\\s+workflow\\b`,
	"i",
);
const GO_BACK = new RegExp(
	`^(?:please\\s+)?go back(?:\\s+to)?(?:\\s+the)?(?:\\s+previous)?\\s+${ID}\\s+workflow\\b`,
	"i",
);

export function parseWorkflowEdit(text: string): WorkflowEditRequest | undefined {
	const source = text.trim();
	const restore = RESTORE.exec(source) ?? GO_BACK.exec(source);
	if (restore?.[1]) {
		return { kind: "restore", id: restore[1].toLowerCase(), instruction: "" };
	}
	const edit = EDIT.exec(source);
	if (edit?.[1]) {
		return { kind: "edit", id: edit[1].toLowerCase(), instruction: (edit[2] ?? "").trim() };
	}
	const create = CREATE.exec(source);
	if (create?.[1]) {
		return { kind: "create", id: create[1].toLowerCase(), instruction: (create[2] ?? "").trim() };
	}
	return undefined;
}

/** A create or edit with no steps and no real description. Restore is never thin. */
export function workflowEditIsThin(request: WorkflowEditRequest): boolean {
	if (request.kind === "restore") return false;
	if (tryWorkflowYaml(request.instruction)) return false;
	return (request.instruction.match(/[a-z]{4,}/gi) ?? []).length < 3;
}

export function workflowEditQuestion(request: WorkflowEditRequest): string {
	if (request.kind === "create") {
		return `What should the ${request.id} workflow do? Say stop to leave it unwritten.`;
	}
	return `What should change in the ${request.id} workflow? Say stop to leave it unchanged.`;
}

export function workflowDraftPrompt(request: WorkflowEditRequest, currentYaml: string | undefined): string {
	return [
		`Write the ${request.id} workflow as one Archon YAML document and nothing else.`,
		"The name is lowercase letters and hyphens.",
		"Use prompt steps only. Each step has id and prompt. After the first step, add depends_on.",
		"Do not use a tool. Do not add a preface.",
		"",
		"Request:",
		request.instruction,
		"",
		"Current YAML:",
		currentYaml && currentYaml.trim().length > 0 ? currentYaml.trim() : "(none)",
	].join("\n");
}

/** The YAML document inside the reply, or the reply itself when it has no fence. */
export function unwrapWorkflowYaml(text: string): string {
	const fence = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i);
	const body = (fence?.[1] ?? text).trim();
	const start = body.search(/^name:/m);
	const yaml = start > 0 ? body.slice(start).trim() : body;
	return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

/** Parsed YAML from a prompt, when the user already wrote the document. */
export function tryWorkflowYaml(text: string): string | undefined {
	const yaml = unwrapWorkflowYaml(text);
	try {
		parseArchonWorkflow(yaml);
		return yaml;
	} catch {
		return undefined;
	}
}
