/**
 * A prompt that creates, edits, restores, or adds a domain workflow.
 * The file write happens only after the YAML parses.
 */

import { parseArchonWorkflow } from "./archon.ts";

export interface WorkflowEditRequest {
	kind: "create" | "edit" | "restore" | "add-workflow";
	id: string;
	/** Workflow name when kind is add-workflow. */
	workflowName?: string;
	instruction: string;
}

const ID = "([a-z][a-z0-9-]{0,40})";
const CREATE = new RegExp(
	`^(?:please\\s+)?(?:create|add|make)\\s+(?:a\\s+)?(?:new\\s+)?(?:domain\\s+)?workflow\\s+(?:for|called|named)\\s+${ID}\\b[\\s,:.-]*(.*)$`,
	"is",
);
const ADD_WORKFLOW = new RegExp(
	`^(?:please\\s+)?(?:add|create|make)\\s+(?:a\\s+)?(?:new\\s+)?workflow\\s+(?:called|named)\\s+${ID}\\s+(?:to|for|on)\\s+(?:the\\s+)?${ID}\\s+domain\\b[\\s,:.-]*(.*)$`,
	"is",
);
const ADD_WORKFLOW_ALT = new RegExp(
	`^(?:please\\s+)?(?:add|create|make)\\s+(?:a\\s+)?(?:new\\s+)?workflow\\s+(?:to|for|on)\\s+(?:the\\s+)?${ID}\\s+domain\\s+(?:called|named)\\s+${ID}\\b[\\s,:.-]*(.*)$`,
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
	const addNamed = ADD_WORKFLOW.exec(source);
	if (addNamed?.[1] && addNamed[2]) {
		return {
			kind: "add-workflow",
			id: addNamed[2].toLowerCase(),
			workflowName: addNamed[1].toLowerCase(),
			instruction: (addNamed[3] ?? "").trim(),
		};
	}
	const addAlt = ADD_WORKFLOW_ALT.exec(source);
	if (addAlt?.[1] && addAlt[2]) {
		return {
			kind: "add-workflow",
			id: addAlt[1].toLowerCase(),
			workflowName: addAlt[2].toLowerCase(),
			instruction: (addAlt[3] ?? "").trim(),
		};
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
	if (request.kind === "add-workflow") {
		const name = request.workflowName ?? "new";
		return `What should the ${name} workflow on ${request.id} do? Say stop to leave it unwritten.`;
	}
	return `What should change in the ${request.id} workflow? Say stop to leave it unchanged.`;
}

export function workflowDraftPrompt(request: WorkflowEditRequest, currentYaml: string | undefined): string {
	const nameHint =
		request.kind === "add-workflow" && request.workflowName
			? `The workflow name must be ${request.workflowName}.`
			: "The name is lowercase letters and hyphens.";
	return [
		`Write the ${request.id} workflow as one Archon YAML document and nothing else.`,
		nameHint,
		"Use prompt or bash steps. Each prompt step has id and prompt. After the first step, add depends_on.",
		"Action steps that run shell must set allowed_tools: [bash] and say Run bash now.",
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
