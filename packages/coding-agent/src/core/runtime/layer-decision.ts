/**
 * Typed layering checkpoints. Schema is enums + required fields only
 * (xAI structured output rejects minLength / maxItems). Lengths are checked in code.
 */

export const LAYER_ACTIONS = ["continue", "escalate", "descalate", "delegate", "verify", "ask_human", "stop"] as const;
export type LayerAction = (typeof LAYER_ACTIONS)[number];

export const LAYER_TARGETS = ["script", "workhorse", "planning", "frontier", "tooling", "verifier"] as const;
export type LayerTarget = (typeof LAYER_TARGETS)[number];

export const LAYER_THINKING = ["off", "brief", "deep"] as const;
export type LayerThinking = (typeof LAYER_THINKING)[number];

export const LAYER_CONFIDENCE = ["low", "medium", "high"] as const;
export type LayerConfidence = (typeof LAYER_CONFIDENCE)[number];

export const LAYERING_DIALECTS = ["anthropic", "openai", "xai", "glm", "kimi", "qwen", "liquid-d1", "scripts"] as const;
export type LayeringDialect = (typeof LAYERING_DIALECTS)[number];

/** Decision may only route to Scripts or Workhorse. */
export const DECISION_ROUTE_TARGETS = ["script", "workhorse"] as const;
export type DecisionRouteTarget = (typeof DECISION_ROUTE_TARGETS)[number];

export interface LayerDecision {
	action: LayerAction;
	target?: LayerTarget;
	thinking?: LayerThinking;
	confidence: LayerConfidence;
	reason: string;
	evidence: string[];
}

export interface HandoffBrief {
	goal: string;
	constraints: string;
	tried: string;
	evidence: string[];
	openQuestion: string;
}

export const LAYER_JOIN = "layer_join";

export const LAYER_SUBTASK_STATUSES = ["ok", "fail", "partial", "halt"] as const;
export type LayerSubtaskStatus = (typeof LAYER_SUBTASK_STATUSES)[number];

export interface LayerSubtaskResult {
	join: typeof LAYER_JOIN;
	status: LayerSubtaskStatus;
	workflow: string;
	output: string;
	evidence: string[];
	winner?: string;
	handoff?: HandoffBrief;
}

export const SAFE_LAYER_DECISION: LayerDecision = {
	action: "continue",
	target: "workhorse",
	thinking: "brief",
	confidence: "low",
	reason: "schema retry exhausted",
	evidence: [],
};

const REASON_MAX = 240;
const EVIDENCE_ITEM_MAX = 160;
const EVIDENCE_COUNT_MAX = 8;

/** Vendor-safe JSON Schema. Do not add minLength / maxLength / minItems / maxItems. */
export const LAYER_DECISION_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["action", "confidence", "reason", "evidence"],
	properties: {
		action: { type: "string", enum: [...LAYER_ACTIONS] },
		target: { type: "string", enum: [...LAYER_TARGETS] },
		thinking: { type: "string", enum: [...LAYER_THINKING] },
		confidence: { type: "string", enum: [...LAYER_CONFIDENCE] },
		reason: { type: "string" },
		evidence: { type: "array", items: { type: "string" } },
	},
} as const;

export const HANDOFF_BRIEF_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["goal", "constraints", "tried", "evidence", "openQuestion"],
	properties: {
		goal: { type: "string" },
		constraints: { type: "string" },
		tried: { type: "string" },
		evidence: { type: "array", items: { type: "string" } },
		openQuestion: { type: "string" },
	},
} as const;

export const LAYER_SUBTASK_RESULT_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["join", "status", "workflow", "output", "evidence"],
	properties: {
		join: { type: "string", enum: [LAYER_JOIN] },
		status: { type: "string", enum: [...LAYER_SUBTASK_STATUSES] },
		workflow: { type: "string" },
		output: { type: "string" },
		evidence: { type: "array", items: { type: "string" } },
		winner: { type: "string" },
		handoff: HANDOFF_BRIEF_JSON_SCHEMA,
	},
} as const;

const LENGTH_KEYWORDS = /"(minLength|maxLength|minItems|maxItems)"/;

export function jsonSchemaHasLengthKeywords(schema: unknown): boolean {
	return LENGTH_KEYWORDS.test(JSON.stringify(schema));
}

/** Undefined when the text is not a LayerDecision object. Does not fall back to SAFE_LAYER_DECISION. */
export function tryParseLayerDecision(text: string): LayerDecision | undefined {
	const parsed = tryLayerDecision(text);
	return parsed ? applyLayerDecisionRules(parsed) : undefined;
}

export function parseLayerDecision(text: string, retry?: () => string | undefined): LayerDecision {
	const first = tryLayerDecision(text);
	if (first) {
		return applyLayerDecisionRules(first);
	}
	const secondText = retry?.();
	if (typeof secondText === "string") {
		const second = tryLayerDecision(secondText);
		if (second) {
			return applyLayerDecisionRules(second);
		}
	}
	return { ...SAFE_LAYER_DECISION };
}

export function parseHandoffBrief(value: unknown): HandoffBrief | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const goal = asTrimmed(record.goal);
	const constraints = asTrimmed(record.constraints);
	const tried = asTrimmed(record.tried);
	const openQuestion = asTrimmed(record.openQuestion);
	const evidence = stringList(record.evidence);
	if (!goal || !constraints || !tried || !openQuestion || !evidence) {
		return undefined;
	}
	return {
		goal: clip(goal, REASON_MAX),
		constraints: clip(constraints, REASON_MAX),
		tried: clip(tried, REASON_MAX),
		evidence: clipList(evidence),
		openQuestion: clip(openQuestion, REASON_MAX),
	};
}

/** JSON object or a labeled one-liner (`goal: …; constraints: …; tried: …; evidence: …; open: …`). */
export function parseHandoffBriefFromText(text: string): HandoffBrief | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			const brief = parseHandoffBrief(parsed);
			if (brief) {
				return brief;
			}
		} catch {
			// labeled prose below
		}
	}
	const fields = new Map<string, string>();
	for (const part of trimmed.split(/[;\n]+/)) {
		const cut = part.indexOf(":");
		if (cut <= 0) {
			continue;
		}
		const key = part.slice(0, cut).trim().toLowerCase().replace(/\s+/g, " ");
		const value = part.slice(cut + 1).trim();
		if (key && value) {
			fields.set(key, value);
		}
	}
	const openQuestion = fields.get("open question") ?? fields.get("openquestion") ?? fields.get("open");
	const evidenceRaw = fields.get("evidence");
	const evidence = evidenceRaw
		? evidenceRaw
				.split(/,(?![^()]*\))/)
				.map((item) => item.trim())
				.filter(Boolean)
		: undefined;
	return parseHandoffBrief({
		goal: fields.get("goal"),
		constraints: fields.get("constraints"),
		tried: fields.get("tried"),
		evidence: evidence && evidence.length > 0 ? evidence : evidenceRaw ? [evidenceRaw] : undefined,
		openQuestion,
	});
}

export function formatHandoffBrief(brief: HandoffBrief): string {
	return [
		`goal: ${brief.goal}`,
		`constraints: ${brief.constraints}`,
		`tried: ${brief.tried}`,
		`evidence: ${brief.evidence.join("; ") || "(none)"}`,
		`open question: ${brief.openQuestion}`,
	].join("\n");
}

export function tryLayerSubtaskResult(text: string): LayerSubtaskResult | undefined {
	return trySubtask(text);
}

export function parseLayerSubtaskResult(text: string, retry?: () => string | undefined): LayerSubtaskResult {
	const first = trySubtask(text);
	if (first) {
		return first;
	}
	const secondText = retry?.();
	if (typeof secondText === "string") {
		const second = trySubtask(secondText);
		if (second) {
			return second;
		}
	}
	return {
		join: LAYER_JOIN,
		status: "halt",
		workflow: "none",
		output: "schema retry exhausted",
		evidence: [],
	};
}

/** Parse a Decision-route checkpoint. Tooling is never a Decision target. */
export function parseDecisionRoute(text: string, retry?: () => string | undefined): LayerDecision {
	return constrainDecisionRoute(parseLayerDecision(text, retry));
}

/** Decision Index / layer-route: never climb to Tooling. */
export function constrainDecisionRoute(decision: LayerDecision): LayerDecision {
	if (decision.target === "tooling") {
		return {
			...decision,
			action: "continue",
			target: "workhorse",
			reason: clip(`${decision.reason} (Decision does not route to Tooling)`, REASON_MAX),
		};
	}
	if (decision.action === "continue" && decision.target && !isDecisionRouteTarget(decision.target)) {
		return { ...decision, target: "workhorse" };
	}
	return decision;
}

export function needsHandoffBrief(action: LayerAction): boolean {
	return action === "escalate" || action === "descalate" || action === "delegate";
}

/** Code-triggered climb: five-field brief from the why line. */
export function climbHandoffBrief(why: string, goal = "continue the task"): HandoffBrief {
	const reason = why.trim() || "climb";
	return {
		goal: clip(goal, REASON_MAX),
		constraints: "do not repeat failed attempts",
		tried: clip(reason, REASON_MAX),
		evidence: clipList([reason]),
		openQuestion: clip(reason, REASON_MAX),
	};
}

export function layerDecisionTextFromEnvelope(dialect: LayeringDialect, envelope: unknown): string {
	if (dialect === "scripts") {
		return JSON.stringify({
			action: "continue",
			target: "script",
			thinking: "off",
			confidence: "high",
			reason: "scripts layer; no chat model",
			evidence: [],
		} satisfies LayerDecision);
	}
	if (dialect === "liquid-d1") {
		return liquidDecisionJson(envelope);
	}
	if (dialect === "anthropic") {
		return anthropicText(envelope);
	}
	if (dialect === "openai" || dialect === "xai" || dialect === "glm" || dialect === "kimi" || dialect === "qwen") {
		return openaiCompatibleText(envelope);
	}
	return "";
}

function tryLayerDecision(text: string): LayerDecision | undefined {
	const raw = extractJsonObject(text);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	if (!isLayerAction(record.action) || !isLayerConfidence(record.confidence)) {
		return undefined;
	}
	const reason = asTrimmed(record.reason);
	const evidence = stringList(record.evidence);
	if (!reason || !evidence) {
		return undefined;
	}
	const decision: LayerDecision = {
		action: record.action,
		confidence: record.confidence,
		reason,
		evidence,
	};
	if (record.target !== undefined) {
		if (!isLayerTarget(record.target)) {
			return undefined;
		}
		decision.target = record.target;
	}
	if (record.thinking !== undefined) {
		if (!isLayerThinking(record.thinking)) {
			return undefined;
		}
		decision.thinking = record.thinking;
	}
	return decision;
}

function applyLayerDecisionRules(decision: LayerDecision): LayerDecision {
	const next: LayerDecision = {
		...decision,
		reason: clip(decision.reason, REASON_MAX),
		evidence: clipList(decision.evidence),
	};
	if (next.action === "escalate" && next.evidence.length === 0) {
		return {
			...next,
			action: "ask_human",
			reason: clip(`${next.reason} (empty evidence blocks escalate)`, REASON_MAX),
		};
	}
	return next;
}

function trySubtask(text: string): LayerSubtaskResult | undefined {
	const raw = extractJsonObject(text);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	if (record.join !== LAYER_JOIN || !isSubtaskStatus(record.status)) {
		return undefined;
	}
	const workflow = asTrimmed(record.workflow);
	const output = asTrimmed(record.output) ?? "";
	const evidence = stringList(record.evidence);
	if (!workflow || !evidence) {
		return undefined;
	}
	const result: LayerSubtaskResult = {
		join: LAYER_JOIN,
		status: record.status,
		workflow,
		output: clip(output, REASON_MAX),
		evidence: clipList(evidence),
	};
	const winner = asTrimmed(record.winner);
	if (winner) {
		result.winner = clip(winner, REASON_MAX);
	}
	if (record.handoff !== undefined) {
		const handoff = parseHandoffBrief(record.handoff);
		if (!handoff) {
			return undefined;
		}
		result.handoff = handoff;
	}
	return result;
}

function liquidDecisionJson(envelope: unknown): string {
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
		return "";
	}
	const record = envelope as Record<string, unknown>;
	const choice = asTrimmed(record.choice) ?? asTrimmed(record.label);
	const target: LayerTarget = choice === "script" ? "script" : "workhorse";
	return JSON.stringify({
		action: "continue",
		target,
		thinking: "off",
		confidence: "medium",
		reason: `d1 chose ${target}`,
		evidence: [],
	} satisfies LayerDecision);
}

function anthropicText(envelope: unknown): string {
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
		return "";
	}
	const content = (envelope as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return typeof (envelope as { text?: unknown }).text === "string"
			? ((envelope as { text: string }).text ?? "")
			: "";
	}
	return content
		.filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "text")
		.map((part) => String((part as { text?: unknown }).text ?? ""))
		.join("\n");
}

function openaiCompatibleText(envelope: unknown): string {
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
		return "";
	}
	const record = envelope as Record<string, unknown>;
	const choices = record.choices;
	if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
		const message = (choices[0] as { message?: { content?: unknown } }).message;
		if (typeof message?.content === "string") {
			return message.content;
		}
	}
	const output = record.output;
	if (Array.isArray(output)) {
		const texts: string[] = [];
		for (const item of output) {
			if (!item || typeof item !== "object") continue;
			const content = (item as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			for (const part of content) {
				if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
					texts.push(String((part as { text: string }).text));
				}
			}
		}
		if (texts.length > 0) {
			return texts.join("\n");
		}
	}
	if (typeof record.content === "string") {
		return record.content;
	}
	return "";
}

function extractJsonObject(text: string): unknown | undefined {
	const trimmed = text.trim();
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = fence?.[1]?.trim() ?? trimmed;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) {
		return undefined;
	}
	try {
		return JSON.parse(body.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

function isLayerAction(value: unknown): value is LayerAction {
	return typeof value === "string" && (LAYER_ACTIONS as readonly string[]).includes(value);
}

function isLayerTarget(value: unknown): value is LayerTarget {
	return typeof value === "string" && (LAYER_TARGETS as readonly string[]).includes(value);
}

function isDecisionRouteTarget(value: string): value is DecisionRouteTarget {
	return (DECISION_ROUTE_TARGETS as readonly string[]).includes(value);
}

function isLayerThinking(value: unknown): value is LayerThinking {
	return typeof value === "string" && (LAYER_THINKING as readonly string[]).includes(value);
}

function isLayerConfidence(value: unknown): value is LayerConfidence {
	return typeof value === "string" && (LAYER_CONFIDENCE as readonly string[]).includes(value);
}

function isSubtaskStatus(value: unknown): value is LayerSubtaskStatus {
	return typeof value === "string" && (LAYER_SUBTASK_STATUSES as readonly string[]).includes(value);
}

function asTrimmed(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		return undefined;
	}
	return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max);
}

function clipList(items: string[]): string[] {
	return items.slice(0, EVIDENCE_COUNT_MAX).map((item) => clip(item, EVIDENCE_ITEM_MAX));
}
