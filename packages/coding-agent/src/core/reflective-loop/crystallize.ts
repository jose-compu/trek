/**
 * L2 to L1. The Planning/Frontier model drafts a skill and says yes or no.
 * A yes is written only after the user confirms. Print mode has no confirm handler, so it writes nothing.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { Lesson } from "./lesson.ts";

export const CRYSTALLIZE_TOOL_NAME = "crystallize";

export const COMPACTION_LESSON_RULE = "Keep the user intent, lesson ids, and errors. Drop verbose tool output.";

export const CRYSTALLIZE_NEEDS_YES = "Crystallize needs a Yes. Nothing was written.";

export interface CrystallizeVerdict {
	promote: "yes" | "no";
	reason: string;
	skill?: string;
}

export interface StoredLesson extends Lesson {
	id: string;
}

interface LessonIndex {
	order: string[];
	lessons: Record<string, Lesson>;
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

export function crystallizePrompt(lesson: Lesson): string {
	return [
		"Decide whether this lesson should become a skill in the system prompt.",
		'Reply with JSON only: {"promote": "yes" | "no", "reason": "...", "skill": "..."}.',
		"skill is one imperative sentence, and is required when promote is yes. No preamble.",
		"",
		`When: ${lesson.trigger}`,
		`Mistake: ${lesson.mistake}`,
		`Rule: ${lesson.rule}`,
		`Domain: ${lesson.domain}`,
	].join("\n");
}

export function parseCrystallize(text: string): CrystallizeVerdict | undefined {
	const parsed = jsonObject(text);
	if (!parsed || typeof parsed !== "object") return undefined;
	const record = parsed as Record<string, unknown>;
	const promote = record.promote === "yes" || record.promote === "no" ? record.promote : undefined;
	const reason = typeof record.reason === "string" ? record.reason.replace(/\s+/g, " ").trim() : "";
	const skill = typeof record.skill === "string" ? record.skill.replace(/\s+/g, " ").trim() : "";
	if (!promote || !reason) return undefined;
	if (promote === "yes" && !skill) return undefined;
	return promote === "yes" ? { promote, reason, skill } : { promote, reason };
}

/** `project:12` becomes `project-12`, a valid skill name. */
export function skillNameForLesson(id: string): string {
	const name = id
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
		throw new Error(`lesson id ${id} is not a skill name`);
	}
	return name;
}

function indexPath(cwd: string): string {
	return join(cwd, ".trek", "lessons", "index.json");
}

function emptyIndex(): LessonIndex {
	return { order: [], lessons: {} };
}

function readIndex(cwd: string): LessonIndex {
	try {
		const raw = JSON.parse(readFileSync(indexPath(cwd), "utf8")) as Partial<LessonIndex>;
		const lessons = raw.lessons && typeof raw.lessons === "object" ? raw.lessons : {};
		const order = Array.isArray(raw.order) ? raw.order.filter((id) => typeof id === "string") : Object.keys(lessons);
		return { order, lessons };
	} catch {
		return emptyIndex();
	}
}

export function saveLessonRecord(cwd: string, id: string, lesson: Lesson): void {
	const index = readIndex(cwd);
	index.lessons[id] = lesson;
	if (!index.order.includes(id)) index.order.push(id);
	const path = indexPath(cwd);
	mkdirSync(join(cwd, ".trek", "lessons"), { recursive: true });
	writeFileSync(path, `${JSON.stringify(index, null, "\t")}\n`);
}

export function loadLessonRecord(cwd: string, id: string): StoredLesson | undefined {
	const lesson = readIndex(cwd).lessons[id];
	return lesson ? { id, ...lesson } : undefined;
}

export function listLessonRecords(cwd: string): StoredLesson[] {
	const index = readIndex(cwd);
	return index.order.flatMap((id) => {
		const lesson = index.lessons[id];
		return lesson ? [{ id, ...lesson }] : [];
	});
}

function skillFile(cwd: string, id: string): string {
	return join(cwd, ".trek", "skills", "lessons", skillNameForLesson(id), "SKILL.md");
}

export function skillIsLive(cwd: string, id: string): boolean {
	return existsSync(skillFile(cwd, id));
}

export function writeCrystallizedSkill(cwd: string, id: string, lesson: Lesson, skill: string): string {
	const path = skillFile(cwd, id);
	const name = skillNameForLesson(id);
	const description = skill.replace(/"/g, "'");
	const body = [
		`Rule: ${skill}`,
		lesson.trigger ? `When: ${lesson.trigger}` : "",
		lesson.mistake ? `Mistake: ${lesson.mistake}` : "",
	]
		.filter(Boolean)
		.join("\n");
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
	return path;
}

/** Move the live skill aside. The lesson row stays. */
export function removeCrystallizedSkill(cwd: string, id: string): string {
	const path = skillFile(cwd, id);
	if (!existsSync(path)) return `no skill for ${id}`;
	const history = join(path, "..", "history");
	mkdirSync(history, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	renameSync(path, join(history, `${stamp}.md`));
	return `removed ${id}`;
}

export function formatLessonsTable(cwd: string): string {
	const rows = listLessonRecords(cwd).map((lesson) => [
		lesson.id,
		lesson.domain,
		skillIsLive(cwd, lesson.id) ? "yes" : "no",
		lesson.rule,
	]);
	if (rows.length === 0) return "No lessons stored.";
	return renderTextTable(["id", "domain", "skill", "rule"], rows, [16, 12, 5, 48]);
}

export function withLessonIds(summary: string, ids: readonly string[]): string {
	if (ids.length === 0) return summary;
	return `${summary}\n\n## Lessons\n${ids.map((id) => `- ${id}`).join("\n")}`;
}

export function lessonIdsFromEntries(
	entries: readonly { type: string; customType?: string; data?: unknown }[],
): string[] {
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== "trek:lesson") continue;
		const id = (entry.data as { id?: unknown } | undefined)?.id;
		if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id);
	}
	return ids;
}

export function createCrystallizeTool(run: (id: string) => Promise<string>): ToolDefinition {
	return {
		name: CRYSTALLIZE_TOOL_NAME,
		label: CRYSTALLIZE_TOOL_NAME,
		description:
			"Ask to turn one stored lesson into a skill. The user must confirm. A no from the promotion model writes nothing.",
		promptSnippet: "Turn a stored lesson into a skill after the user confirms",
		reversibilityTier: "gated",
		parameters: Type.Object({
			lesson_id: Type.String({ description: "Stored lesson id, for example project:1" }),
		}),
		execute: async (_toolCallId, params) => {
			const id = String((params as { lesson_id?: string }).lesson_id ?? "").trim();
			const text = await run(id);
			return { content: [{ type: "text", text }], details: undefined };
		},
	};
}

function renderTextTable(headers: string[], rows: string[][], maxWidths?: number[]): string {
	const widths = headers.map((header, index) => {
		const natural = Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
		const cap = maxWidths?.[index];
		return cap ? Math.max(header.length, Math.min(natural, cap)) : natural;
	});
	const rule = (left: string, mid: string, right: string) =>
		`${left}${widths.map((width) => "─".repeat(width + 2)).join(mid)}${right}`;
	const line = (cells: string[]) =>
		`│${cells.map((cell, index) => ` ${cell.padEnd(widths[index] ?? 0)} `).join("│")}│`;
	const body = rows.flatMap((row) => {
		const wrapped = row.map((cell, index) => wrapCell(cell ?? "", widths[index] ?? 1));
		const height = Math.max(1, ...wrapped.map((cell) => cell.length));
		const lines: string[] = [];
		for (let index = 0; index < height; index++) {
			lines.push(line(wrapped.map((cell) => cell[index] ?? "")));
		}
		return lines;
	});
	return [rule("┌", "┬", "┐"), line(headers), rule("├", "┼", "┤"), ...body, rule("└", "┴", "┘")].join("\n");
}

function wrapCell(text: string, width: number): string[] {
	const words = text.split(" ").filter((word) => word.length > 0);
	if (words.length === 0) return [""];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const piece = word.length > width ? word.slice(0, width) : word;
		if (!current) current = piece;
		else if (current.length + 1 + piece.length <= width) current = `${current} ${piece}`;
		else {
			lines.push(current);
			current = piece;
		}
	}
	if (current) lines.push(current);
	return lines;
}
