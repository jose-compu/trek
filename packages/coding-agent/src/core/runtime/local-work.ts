/**
 * Extra system instruction for a pure local suite.
 * Small GGUFs otherwise answer like a web chat and paste a tutorial.
 */

import { SMALL_CONTEXT_TOOLS } from "./context-budget.ts";

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

export interface LooseToolMessage {
	stopReason: string;
	content: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: unknown }>;
}

interface LooseCall {
	name: string;
	arguments: Record<string, unknown>;
}

const MAX_LIFTED_CALLS = 4;
const MAX_TOOL_NAME_LEN = 64;
const MAX_PATH_OR_COMMAND_LEN = 8192;
const MAX_WRITE_CONTENT_LEN = 512_000;
const MAX_EDIT_REPLACEMENTS = 32;
const MAX_EDIT_TEXT_LEN = 256_000;

const LIFT_ARG_KEYS: Record<string, ReadonlySet<string>> = {
	read: new Set(["path", "offset", "limit"]),
	write: new Set(["path", "content", "file_path"]),
	edit: new Set(["path", "edits", "oldText", "newText", "replaceAll"]),
	bash: new Set(["command", "timeout"]),
};

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function allowedLiftTools(names?: Iterable<string>): ReadonlySet<string> {
	const allowed = new Set(names ?? SMALL_CONTEXT_TOOLS);
	for (const name of allowed) {
		if (!isSafeToolIdentifier(name)) {
			allowed.delete(name);
		}
	}
	return allowed;
}

function isSafeToolIdentifier(name: string): boolean {
	return name.length > 0 && name.length <= MAX_TOOL_NAME_LEN && /^[a-z][a-z0-9_]*$/i.test(name);
}

function truncateString(value: string, max: number): string | undefined {
	if (value.length > max) {
		return undefined;
	}
	if (value.includes("\0")) {
		return undefined;
	}
	return value;
}

function sanitizeEditReplacements(value: unknown): unknown[] | undefined {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EDIT_REPLACEMENTS) {
		return undefined;
	}
	const edits: unknown[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			return undefined;
		}
		const record = item as Record<string, unknown>;
		const oldText = record.oldText;
		const newText = record.newText;
		if (typeof oldText !== "string" || typeof newText !== "string") {
			return undefined;
		}
		const old = truncateString(oldText, MAX_EDIT_TEXT_LEN);
		const next = truncateString(newText, MAX_EDIT_TEXT_LEN);
		if (old === undefined || next === undefined) {
			return undefined;
		}
		const edit: Record<string, unknown> = { oldText: old, newText: next };
		if (typeof record.replaceAll === "boolean") {
			edit.replaceAll = record.replaceAll;
		}
		edits.push(edit);
	}
	return edits;
}

function sanitizeToolArguments(tool: string, args: Record<string, unknown>): Record<string, unknown> | undefined {
	const keys = LIFT_ARG_KEYS[tool];
	if (!keys) {
		return undefined;
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (DANGEROUS_KEYS.has(key) || !keys.has(key)) {
			continue;
		}
		if (key === "path" || key === "file_path") {
			if (typeof value !== "string") {
				continue;
			}
			const path = truncateString(value, MAX_PATH_OR_COMMAND_LEN);
			if (!path) {
				return undefined;
			}
			out[key] = path;
			continue;
		}
		if (key === "content") {
			if (typeof value !== "string") {
				return undefined;
			}
			const content = truncateString(value, MAX_WRITE_CONTENT_LEN);
			if (content === undefined) {
				return undefined;
			}
			out.content = content;
			continue;
		}
		if (key === "command") {
			if (typeof value !== "string") {
				return undefined;
			}
			const command = truncateString(value, MAX_PATH_OR_COMMAND_LEN);
			if (!command) {
				return undefined;
			}
			out.command = command;
			continue;
		}
		if (key === "edits") {
			const edits = sanitizeEditReplacements(value);
			if (!edits) {
				return undefined;
			}
			out.edits = edits;
			continue;
		}
		if (key === "oldText" || key === "newText") {
			if (typeof value !== "string") {
				continue;
			}
			const text = truncateString(value, MAX_EDIT_TEXT_LEN);
			if (text === undefined) {
				return undefined;
			}
			out[key] = text;
			continue;
		}
		if (key === "offset" || key === "limit" || key === "timeout") {
			if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
				out[key] = value;
			}
			continue;
		}
		if (key === "replaceAll" && typeof value === "boolean") {
			out.replaceAll = value;
		}
	}
	if (tool === "write") {
		const path = (out.path ?? out.file_path) as string | undefined;
		if (typeof path !== "string" || typeof out.content !== "string") {
			return undefined;
		}
	}
	if (tool === "read" && typeof out.path !== "string") {
		return undefined;
	}
	if (tool === "bash" && typeof out.command !== "string") {
		return undefined;
	}
	if (tool === "edit") {
		const hasPath = typeof out.path === "string";
		const hasEdits = Array.isArray(out.edits) && out.edits.length > 0;
		const hasLegacy = typeof out.oldText === "string" && typeof out.newText === "string";
		if (!hasPath || (!hasEdits && !hasLegacy)) {
			return undefined;
		}
	}
	return out;
}

function sanitizeLooseCall(
	name: string,
	args: Record<string, unknown>,
	allowed: ReadonlySet<string>,
): LooseCall | undefined {
	if (!allowed.has(name) || !isSafeToolIdentifier(name)) {
		return undefined;
	}
	const arguments_ = sanitizeToolArguments(name, args);
	if (!arguments_) {
		return undefined;
	}
	return { name, arguments: arguments_ };
}

function parsedToolShape(value: unknown): boolean {
	if (!value || typeof value !== "object") {
		return false;
	}
	if (Array.isArray(value)) {
		return value.every((item) => parsedToolShape(item));
	}
	const record = value as Record<string, unknown>;
	return typeof record.name === "string" && record.arguments !== undefined && typeof record.arguments === "object";
}

/**
 * Some local models print a tool call as JSON in the reply
 * instead of the server's tool_calls field. That text never runs.
 * The last complete call list in the reply is the one that runs.
 */
export function liftLocalToolText<T extends LooseToolMessage>(message: T, allowedToolNames?: Iterable<string>): T {
	if (message.content.some((part) => part.type === "toolCall")) {
		return message;
	}
	const allowed = allowedLiftTools(allowedToolNames);
	const text = message.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("");
	const thinking = message.content
		.filter((part) => part.type === "thinking" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("");
	const calls = parseLooseToolCalls(text, allowed) ?? parseLooseToolCalls(thinking, allowed);
	if (!calls || calls.length === 0) {
		return message;
	}
	return {
		...message,
		stopReason: "toolUse",
		content: [
			...message.content.filter((part) => part.type === "thinking"),
			...calls.slice(0, MAX_LIFTED_CALLS).map((call, index) => ({
				type: "toolCall",
				id: `local-tool-${index + 1}`,
				name: call.name,
				arguments: call.arguments,
			})),
		],
	};
}

function balancedJson(text: string, start: number): string | undefined {
	const open = text[start];
	if (open !== "{" && open !== "[") {
		return undefined;
	}
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === open) {
			depth++;
		} else if (ch === close) {
			depth--;
			if (depth === 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return undefined;
}

function parseJsonValue(slice: string): unknown {
	try {
		return JSON.parse(slice) as unknown;
	} catch {
		// A pretty-printed reply sometimes puts a raw newline inside a string.
		let repaired = "";
		let inString = false;
		let escaped = false;
		for (const ch of slice) {
			if (inString) {
				if (escaped) {
					repaired += ch;
					escaped = false;
					continue;
				}
				if (ch === "\\") {
					repaired += ch;
					escaped = true;
					continue;
				}
				if (ch === '"') {
					inString = false;
					repaired += ch;
					continue;
				}
				if (ch === "\n") {
					repaired += "\\n";
					continue;
				}
				if (ch === "\r") {
					continue;
				}
			} else if (ch === '"') {
				inString = true;
			}
			repaired += ch;
		}
		try {
			return JSON.parse(repaired) as unknown;
		} catch {
			return undefined;
		}
	}
}

function asCall(value: unknown, allowed: ReadonlySet<string>): LooseCall | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as { name?: unknown; arguments?: unknown };
	if (typeof record.name !== "string" || record.name.length === 0) {
		return undefined;
	}
	let args = record.arguments;
	if (typeof args === "string") {
		args = parseJsonValue(args);
	}
	if (!args || typeof args !== "object" || Array.isArray(args)) {
		return undefined;
	}
	return sanitizeLooseCall(record.name, args as Record<string, unknown>, allowed);
}

function asCalls(value: unknown, allowed: ReadonlySet<string>): LooseCall[] | undefined {
	if (Array.isArray(value)) {
		if (value.length === 0 || value.length > MAX_LIFTED_CALLS) {
			return undefined;
		}
		const calls: LooseCall[] = [];
		for (const item of value) {
			const call = asCall(item, allowed);
			if (!call) {
				return undefined;
			}
			calls.push(call);
		}
		return calls;
	}
	const call = asCall(value, allowed);
	return call ? [call] : undefined;
}

function parseLooseToolCalls(text: string, allowed: ReadonlySet<string>): LooseCall[] | undefined {
	let best: LooseCall[] | undefined;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== "{" && ch !== "[") {
			continue;
		}
		const slice = balancedJson(text, i);
		if (!slice) {
			continue;
		}
		const parsed = parseJsonValue(slice);
		if (!parsedToolShape(parsed)) {
			continue;
		}
		const calls = asCalls(parsed, allowed);
		if (!calls) {
			if (ch === "[") {
				i += slice.length - 1;
			}
			continue;
		}
		if (!best || calls.length >= best.length) {
			best = calls;
		}
		if (ch === "[") {
			i += slice.length - 1;
		}
	}
	return best;
}

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
	"Use the write tool on a file inside the folder, such as index.html. Do not use the folder path as the file. Then use the bash tool. Do not claim a command ran unless you called it.";

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
