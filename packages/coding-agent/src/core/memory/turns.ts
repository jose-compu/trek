/**
 * Compact session rows. Thinking is separate from the question-and-answer row.
 */

import type { AgentMessage } from "@trek/agent-core";

export const QUESTION_CAP = 300;
export const ANSWER_CAP = 500;
export const THINKING_CAP = 800;
export const THINKING_MIN = 40;

export interface TurnCapture {
	turn?: string;
	thinking?: { excerpt: string; question: string };
}

export function captureTurn(messages: readonly AgentMessage[], cwd: string): TurnCapture {
	const question = lastUserText(messages);
	const answer = lastAssistantText(messages);
	const thinking = lastThinking(messages);
	const result: TurnCapture = {};
	if (answer) {
		const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
		const dir = cwd.split(/[/\\]/).filter(Boolean).slice(-2).join("/");
		result.turn = [
			`[${stamp}] ${dir}`,
			`Q: ${question.slice(0, QUESTION_CAP)}`,
			`A: ${answer.slice(0, ANSWER_CAP)}`,
		].join("\n");
	}
	if (thinking && question) {
		const excerpt = thinking.slice(0, THINKING_CAP);
		if (excerpt.length >= THINKING_MIN && excerpt.trim() !== answer.trim()) {
			result.thinking = { excerpt, question };
		}
	}
	return result;
}

export function handoffNote(cwd: string): string {
	return `[Handoff ${new Date().toISOString().slice(0, 16)}] ${cwd}`;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "text")
		.map((part) => String((part as { text?: string }).text ?? ""))
		.join(" ")
		.trim();
}

function lastUserText(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "user") continue;
		const text = textOf(message.content);
		if (text) return text;
	}
	return "";
}

function lastAssistantText(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const text = textOf(message.content);
		if (text) return text;
	}
	return "";
}

function lastThinking(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		const blocks = content.filter((part) => {
			if (!part || typeof part !== "object") return false;
			const block = part as { type?: string; thinking?: string; redacted?: boolean };
			return block.type === "thinking" && block.redacted !== true && Boolean(block.thinking?.trim());
		}) as Array<{ thinking?: string }>;
		const text = blocks[blocks.length - 1]?.thinking?.trim() ?? "";
		if (text) return text;
	}
	return "";
}
