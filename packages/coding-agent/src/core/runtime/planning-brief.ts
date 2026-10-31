/**
 * Planning brief + optional mid-turn replan when Workhorse elevates or a tool fails.
 */

export const PLANNING_REPLAN_EVERY = 3;

export function planningReplanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TREK_PLANNING_REPLAN !== "0";
}

/**
 * Replan when Workhorse elevated, a tool failed, or enough tools passed after an
 * active plan. Not every turn — elevation is the primary trigger.
 */
export function shouldReplanAfterTool(input: {
	toolsSincePlan: number;
	isError: boolean;
	elevated?: boolean;
	planActive?: boolean;
	enabled?: boolean;
}): boolean {
	if (input.enabled === false) {
		return false;
	}
	if (input.elevated) {
		return true;
	}
	if (input.isError && input.planActive) {
		return true;
	}
	if (input.planActive && input.toolsSincePlan >= PLANNING_REPLAN_EVERY) {
		return true;
	}
	return false;
}

export function planningBriefPrompt(task: string, why?: string): string {
	const lines = [
		"Reply with a short plan only.",
		'JSON: {"goal":"...","files":["..."],"order":["..."],"next":"read|write|edit|bash ...","stop":"..."}',
		"Do not call tools. Do not write file contents.",
		"",
		"Task:",
		task,
	];
	if (why?.trim()) {
		lines.push("", "Elevation reason:", why.trim());
	}
	return lines.join("\n");
}

export function planningReplanPrompt(input: {
	task: string;
	priorPlan: string;
	toolName: string;
	resultSnippet: string;
	isError: boolean;
	why?: string;
}): string {
	const status = input.isError ? "failed" : "ok";
	const lines = [
		"Update the plan after the latest tool result. Reply with a short plan only.",
		'JSON: {"goal":"...","files":["..."],"order":["..."],"next":"read|write|edit|bash ...","stop":"..."}',
		"Do not call tools. Do not write file contents.",
		"",
		"Task:",
		input.task,
		"",
		"Prior plan:",
		input.priorPlan || "(none)",
		"",
		`Latest tool ${input.toolName} (${status}):`,
		input.resultSnippet.slice(0, 1200) || "(empty)",
	];
	if (input.why?.trim()) {
		lines.push("", "Elevation reason:", input.why.trim());
	}
	return lines.join("\n");
}

export function extractPlanBody(systemPrompt: string): string {
	const match = systemPrompt.match(/<plan\b[^>]*>([\s\S]*?)<\/plan>/i);
	return match?.[1]?.trim() ?? "";
}

export function applyPlanBlock(systemPrompt: string, role: string, reason: string, body: string): string {
	const block = `<plan role="${role}" reason="${reason}">\n${body.trim()}\n</plan>`;
	const planTag = /<plan\b[^>]*>[\s\S]*?<\/plan>/i;
	if (planTag.test(systemPrompt)) {
		return systemPrompt.replace(/<plan\b[^>]*>[\s\S]*?<\/plan>/i, block);
	}
	return `${systemPrompt}\n\n${block}`;
}

export function toolResultSnippet(result: { content: Array<{ type: string; text?: string }> } | undefined): string {
	if (!result?.content) {
		return "";
	}
	return result.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}
