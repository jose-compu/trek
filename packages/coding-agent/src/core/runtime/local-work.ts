/**
 * Extra system instruction for a pure local suite.
 * Small GGUFs otherwise answer like a web chat and paste a tutorial.
 */

export const LOCAL_SUITE_WORK_SECTION = `## Local suite

You are on this computer, in the current folder. You have read, write, edit, and bash.

When the user asks you to build, run, install, or open something, call a tool first.
- Create and edit the files here with the write and edit tools.
- Run the commands with the bash tool.
- Start a local server and open the browser yourself when they ask to see it.
- The files on disk are the result. Do not answer with a tutorial, pasted code, or steps for the user to run.
- Do not say you cannot run a program or open a browser. Use the tools.`;

const WORK_REQUEST =
	/\b(build|create|make|implement|write|add|fix|run|start|install|open|launch|scaffold|deploy|code|edit)\b/i;

const FILE_TOOLS = new Set(["write", "edit"]);

/** Stop forcing a tool call after this many tool turns in one user request. */
const MAX_FORCED_TOOL_TURNS = 8;

export interface LocalToolChoiceMessage {
	role: string;
	content?: unknown;
	toolName?: string;
}

function messageText(message: LocalToolChoiceMessage): string {
	const { content } = message;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			if (!part || typeof part !== "object") {
				return "";
			}
			const record = part as { type?: string; text?: string };
			return record.type === "text" && typeof record.text === "string" ? record.text : "";
		})
		.join("\n");
}

function toolNames(message: LocalToolChoiceMessage): string[] {
	const names: string[] = [];
	if (message.role === "toolResult" && message.toolName) {
		names.push(message.toolName);
	}
	if (!Array.isArray(message.content)) {
		return names;
	}
	for (const part of message.content) {
		if (!part || typeof part !== "object") {
			continue;
		}
		const record = part as { type?: string; name?: string };
		if (record.type === "toolCall" && record.name) {
			names.push(record.name);
		}
	}
	return names;
}

/**
 * LFM's chat template lists tools but does not force them.
 * This sentence, on the user message, is what makes it call write.
 */
export const LOCAL_WORK_TOOL_NUDGE =
	"Use the write tool to create the files in this folder, then the bash tool to run them and open the browser. Do not explain.";

function withNudge(content: unknown): unknown {
	const line = `\n\n${LOCAL_WORK_TOOL_NUDGE}`;
	if (typeof content === "string") {
		return content + line;
	}
	if (!Array.isArray(content)) {
		return content;
	}
	const copy = content.map((part) => (part && typeof part === "object" ? { ...part } : part));
	for (let i = copy.length - 1; i >= 0; i--) {
		const part = copy[i];
		if (!part || typeof part !== "object") {
			continue;
		}
		const record = part as { type?: string; text?: string };
		if (record.type === "text" && typeof record.text === "string") {
			copy[i] = { ...record, text: record.text + line };
			return copy;
		}
	}
	copy.push({ type: "text", text: LOCAL_WORK_TOOL_NUDGE });
	return copy;
}

/** Copy of the request messages. The saved user turn is left unchanged. */
export function nudgeLocalWorkMessages<T extends LocalToolChoiceMessage>(messages: readonly T[]): T[] {
	if (localSuiteToolChoice(messages) !== "required") {
		return [...messages];
	}
	let lastUser = -1;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]?.role === "user") {
			lastUser = i;
		}
	}
	if (lastUser < 0) {
		return [...messages];
	}
	return messages.map((message, index) =>
		index === lastUser ? ({ ...message, content: withNudge(message.content) } as T) : message,
	);
}

/**
 * Small local GGUFs answer a build request as a tutorial when tool use is optional.
 * Require a tool call until a file tool and bash have both run.
 */
export function localSuiteToolChoice(messages: readonly LocalToolChoiceMessage[]): "required" | undefined {
	let lastUser = -1;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]?.role === "user") {
			lastUser = i;
		}
	}
	if (lastUser < 0 || !WORK_REQUEST.test(messageText(messages[lastUser]!))) {
		return undefined;
	}

	let toolTurns = 0;
	let sawFile = false;
	let sawBash = false;
	for (let i = lastUser + 1; i < messages.length; i++) {
		const names = toolNames(messages[i]!);
		if (messages[i]?.role === "assistant" && names.length > 0) {
			toolTurns++;
		}
		if (names.some((name) => FILE_TOOLS.has(name))) {
			sawFile = true;
		}
		if (names.includes("bash")) {
			sawBash = true;
		}
	}
	if (toolTurns >= MAX_FORCED_TOOL_TURNS || (sawFile && sawBash)) {
		return undefined;
	}
	return "required";
}
