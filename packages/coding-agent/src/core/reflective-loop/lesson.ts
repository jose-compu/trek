/**
 * Lessons. The work-horse writes one after a failed or corrected turn (L3).
 * The Planning/Frontier model chooses which stored lessons enter the prompt (L2).
 */

export interface Lesson {
	trigger: string;
	mistake: string;
	rule: string;
	domain: string;
}

export interface LessonEvidence {
	kind: "error" | "correction";
	task: string;
	/** Tool errors, law blocks, and effort stops from the turn. */
	failures: string[];
	reply: string;
	correction?: string;
}

export interface LessonCandidate {
	id: string;
	text: string;
}

export const MAX_LESSON_CANDIDATES = 20;
export const MAX_PROMOTED_LESSONS = 5;

const CORRECTION =
	/^(?:no\b|nope\b|wrong\b|that(?: is|'s) (?:wrong|not (?:right|what i asked))|not what i asked|you (?:broke|missed)|\/undo\b)/i;

export function isCorrection(text: string): boolean {
	return CORRECTION.test(text.trim());
}

export function lessonsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TREK_LESSONS !== "0";
}

export function lessonPromotionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TREK_LESSON_PROMOTION !== "0";
}

interface TurnMessage {
	role: string;
	isError?: boolean;
	toolName?: string;
	content?: unknown;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part && typeof part === "object" && part.type === "text" ? String(part.text ?? "") : ""))
		.filter(Boolean)
		.join("\n");
}

/** Tool errors and effort stops in one turn. Empty when the turn went cleanly. */
export function turnFailures(messages: readonly TurnMessage[], limit = 3): string[] {
	const failures: string[] = [];
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		const text = textOf(message.content).trim();
		const stopped = /EffortRegulator stopped: [a-z ]+\./.exec(text)?.[0];
		if (message.isError) {
			failures.push(`${message.toolName ?? "tool"}: ${text.slice(0, 300)}`);
		} else if (stopped) {
			failures.push(`${message.toolName ?? "tool"}: ${stopped}`);
		}
		if (failures.length >= limit) break;
	}
	return failures;
}

export function lessonPrompt(evidence: LessonEvidence): string {
	const lines = [
		"Write one lesson from this turn so the next session does not repeat the mistake.",
		'Reply with JSON only: {"trigger": "...", "mistake": "...", "rule": "...", "domain": "..."}.',
		"trigger: the kind of task where this applies. mistake: what went wrong. rule: one imperative sentence to follow next time. domain: one lowercase word.",
		"Use only facts from this turn. No preamble.",
		"",
		`Task: ${evidence.task.slice(0, 600)}`,
	];
	if (evidence.failures.length > 0) lines.push(`Failures:\n${evidence.failures.map((f) => `- ${f}`).join("\n")}`);
	if (evidence.reply) lines.push(`Reply: ${evidence.reply.slice(0, 600)}`);
	if (evidence.correction) lines.push(`User correction: ${evidence.correction.slice(0, 400)}`);
	return lines.join("\n");
}

function jsonObject(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

function field(record: Record<string, unknown>, name: string): string {
	const value = record[name];
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function parseLesson(text: string): Lesson | undefined {
	const parsed = jsonObject(text);
	if (!parsed || typeof parsed !== "object") return undefined;
	const record = parsed as Record<string, unknown>;
	const rule = field(record, "rule");
	if (!rule) return undefined;
	const domain = field(record, "domain").toLowerCase();
	return {
		trigger: field(record, "trigger"),
		mistake: field(record, "mistake"),
		rule,
		domain: /^[a-z][a-z0-9-]{0,30}$/.test(domain) ? domain : "general",
	};
}

export function formatLesson(lesson: Lesson): string {
	const parts = [`Rule: ${lesson.rule}`];
	if (lesson.trigger) parts.push(`When: ${lesson.trigger}`);
	if (lesson.mistake) parts.push(`Mistake: ${lesson.mistake}`);
	return parts.join("\n");
}

/** A stored lesson row without its `[kind:lesson][tag:...]` header. */
export function lessonBody(stored: string): string {
	return stored.replace(/^\[kind:lesson\](?:\[tag:[^\]]*\])?\s*/, "");
}

export function promotionPrompt(query: string, candidates: readonly LessonCandidate[]): string {
	return [
		`Choose the stored lessons that apply to this prompt. At most ${MAX_PROMOTED_LESSONS}. None is a valid answer.`,
		'Reply with JSON only: {"ids": ["..."]}. Use ids from the list. No preamble.',
		"",
		`Prompt: ${query.slice(0, 600)}`,
		"",
		"Lessons:",
		...candidates.map(
			(candidate) => `${candidate.id}: ${lessonBody(candidate.text).replace(/\s+/g, " ").slice(0, 300)}`,
		),
	].join("\n");
}

/** Ids not in the candidate list are dropped. Undefined when the reply is not usable. */
export function parsePromotion(text: string, candidateIds: readonly string[]): string[] | undefined {
	const parsed = jsonObject(text);
	if (!parsed || typeof parsed !== "object") return undefined;
	const ids = (parsed as { ids?: unknown }).ids;
	if (!Array.isArray(ids)) return undefined;
	const known = new Set(candidateIds);
	const picked: string[] = [];
	for (const id of ids) {
		if (typeof id === "string" && known.has(id) && !picked.includes(id)) picked.push(id);
		if (picked.length >= MAX_PROMOTED_LESSONS) break;
	}
	return picked;
}
