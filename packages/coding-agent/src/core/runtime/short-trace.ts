import type { ThinkingBudgets, ThinkingLevel } from "@trek/ai";

/** One observation and the next tool. A monologue is not an act. */
export const SHORT_TRACE_MAX_TOKENS = 128;
export const SHORT_TRACE_MAX_SENTENCES = 3;

export const SHORT_TRACE_SECTION = `## Short trace

Each span is one observation and the next tool, then the tool runs.
Keep thinking and the answer to at most ${SHORT_TRACE_MAX_SENTENCES} sentences or ${SHORT_TRACE_MAX_TOKENS} tokens before that tool call.
A monologue is not an act.`;

/** Token budget for providers that honor a thinking budget. */
export const SHORT_TRACE_THINKING_BUDGETS: ThinkingBudgets = {
	minimal: SHORT_TRACE_MAX_TOKENS,
	low: SHORT_TRACE_MAX_TOKENS,
	medium: SHORT_TRACE_MAX_TOKENS,
	high: SHORT_TRACE_MAX_TOKENS,
};

export interface ShortTraceContext {
	systemPrompt?: string;
	tools?: readonly unknown[];
}

export function applyShortTraceContext<T extends ShortTraceContext>(context: T): T {
	if (!context.tools || context.tools.length === 0) {
		return context;
	}
	const prompt = context.systemPrompt ?? "";
	if (prompt.includes("## Short trace")) {
		return context;
	}
	const systemPrompt = prompt ? `${SHORT_TRACE_SECTION}\n\n${prompt}` : SHORT_TRACE_SECTION;
	return { ...context, systemPrompt };
}

export function applyShortTraceOptions<T extends { reasoning?: ThinkingLevel; thinkingBudgets?: ThinkingBudgets }>(
	options: T | undefined,
	hasTools: boolean,
): T & { thinkingBudgets?: ThinkingBudgets } {
	const base = (options ?? {}) as T;
	if (!hasTools) {
		return base;
	}
	return {
		...base,
		...(base.reasoning ? { reasoning: "minimal" as const } : {}),
		thinkingBudgets: {
			...base.thinkingBudgets,
			...SHORT_TRACE_THINKING_BUDGETS,
		},
	};
}

export function estimateTokens(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) {
		return 0;
	}
	return trimmed.split(/\s+/).length;
}

export function sentenceCount(text: string): number {
	return text
		.split(/[.!?]+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0).length;
}

export interface TraceSpanEvent {
	type: "thinking" | "text" | "tool";
	text?: string;
}

/** Tokens of thinking and answer text before the first tool call. */
export function tokensBeforeTool(events: readonly TraceSpanEvent[]): number {
	let text = "";
	for (const event of events) {
		if (event.type === "tool") {
			return estimateTokens(text);
		}
		text += ` ${event.text ?? ""}`;
	}
	return estimateTokens(text);
}

export function spanWithinCap(events: readonly TraceSpanEvent[]): boolean {
	let text = "";
	for (const event of events) {
		if (event.type === "tool") {
			break;
		}
		text += ` ${event.text ?? ""}`;
	}
	return estimateTokens(text) <= SHORT_TRACE_MAX_TOKENS && sentenceCount(text) <= SHORT_TRACE_MAX_SENTENCES;
}

/** API models emit a short thinking span, then the tool. */
export function apiShortTraceFixture(): TraceSpanEvent[] {
	return [
		{ type: "thinking", text: "The file is missing. Write it." },
		{ type: "tool", text: "write" },
	];
}

/** Local GGUFs have no separate thinking channel. The answer itself stays short. */
export function localShortTraceFixture(): TraceSpanEvent[] {
	return [
		{ type: "text", text: "Creating the file." },
		{ type: "tool", text: "write" },
	];
}
