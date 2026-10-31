/**
 * Per-domain lesson patterns. Parsed once per process, keyed by file mtimes.
 * A bad file is skipped. It must not throw on the prompt path.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { getPackageDir } from "../../config.ts";
import type { Lesson } from "../reflective-loop/lesson.ts";

export type LessonSeverity = "low" | "medium" | "high" | "critical";

export interface LessonPattern {
	domain: string;
	categories: string[];
	areas: string[];
	severity: Record<string, LessonSeverity>;
	beforeAfter: boolean;
	fields: Array<{ name: string; required: boolean }>;
	promotionTargets: Array<{ id: string; title: string }>;
	promotionThreshold: { count: number; severity?: LessonSeverity };
	redact: RegExp[];
}

export interface LessonScope {
	cwd: string;
	selected: string;
	catalogIds: ReadonlySet<string>;
	alwaysOn: ReadonlySet<string>;
}

export interface TypedLessonResult {
	lesson?: Lesson;
	reason?: string;
}

const SEVERITY_RANK: Record<LessonSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

const GLOBAL_REDACT: RegExp[] = [
	/\bsk-[A-Za-z0-9_-]{8,}\b/,
	/\bxai-[A-Za-z0-9_-]{8,}\b/,
	/\bghp_[A-Za-z0-9]{8,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,60}$/;

let cached: { stamp: string; patterns: Map<string, LessonPattern> } | undefined;

export function bundledLessonRoot(): string {
	return join(getPackageDir(), "domains");
}

/** Stat the pattern files. Parse only when a file changed. */
export function warmLessonPatterns(cwd: string, bundledRoot = bundledLessonRoot()): Map<string, LessonPattern> {
	const stamp = patternStamp(cwd, bundledRoot);
	if (cached?.stamp === stamp) return cached.patterns;
	const patterns = new Map<string, LessonPattern>();
	if (existsSync(bundledRoot)) {
		for (const domain of readDomainIds(bundledRoot)) {
			const file = join(bundledRoot, domain, "lessons.yaml");
			const pattern = readPatternFile(file, domain);
			if (pattern) patterns.set(domain, pattern);
		}
	}
	const localRoot = join(cwd, ".trek", "domains");
	if (existsSync(localRoot)) {
		for (const domain of readDomainIds(localRoot)) {
			const file = join(localRoot, domain, "lessons.yaml");
			if (!existsSync(file)) continue;
			const pattern = readPatternFile(file, domain);
			if (pattern) patterns.set(domain, pattern);
		}
	}
	cached = { stamp, patterns };
	return patterns;
}

export function clearLessonPatternCache(): void {
	cached = undefined;
}

export function lessonPatternFor(cwd: string, domain: string): LessonPattern | undefined {
	if (!domain || domain === "none") return undefined;
	return warmLessonPatterns(cwd).get(domain);
}

export function lessonAllowed(
	tag: string | undefined,
	selected: string,
	catalogIds: ReadonlySet<string>,
	alwaysOn: ReadonlySet<string>,
): boolean {
	if (!tag || !catalogIds.has(tag)) return true;
	if (alwaysOn.has(tag)) return true;
	return tag === selected;
}

export function lessonTag(stored: string): string | undefined {
	const tag = /\[tag:([^\]]*)\]/.exec(stored)?.[1]?.trim();
	return tag ? tag : undefined;
}

export function acceptTypedLesson(text: string, pattern: LessonPattern): TypedLessonResult {
	const record = jsonRecord(text);
	if (!record) return { reason: "the reply was not JSON" };
	const rule = textField(record, "rule");
	if (!rule) return { reason: "rule is missing" };
	const category = textField(record, "category");
	if (!pattern.categories.includes(category)) return { reason: `unknown category ${category || "(empty)"}` };
	const area = textField(record, "area");
	if (pattern.areas.length > 0 && !pattern.areas.includes(area)) {
		return { reason: `area must be one of ${pattern.areas.join(", ")}` };
	}
	const before = textField(record, "before");
	const after = textField(record, "after");
	if (pattern.beforeAfter && (!before || !after)) return { reason: "before and after are required" };
	const fields: Record<string, string> = {};
	const rawFields = record.fields;
	const given: Record<string, unknown> =
		rawFields && typeof rawFields === "object" ? (rawFields as Record<string, unknown>) : {};
	for (const field of pattern.fields) {
		const raw = given[field.name];
		const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
		if (field.required && !value) return { reason: `${field.name} is required` };
		if (value) fields[field.name] = value;
	}
	const floor = pattern.severity[category] ?? pattern.severity.default ?? "medium";
	const lesson: Lesson = {
		trigger: textField(record, "trigger"),
		mistake: textField(record, "mistake"),
		rule,
		domain: pattern.domain,
		category,
		area: area || undefined,
		severity: clampSeverity(textField(record, "severity"), floor),
		before: before || undefined,
		after: after || undefined,
		fields: Object.keys(fields).length > 0 ? fields : undefined,
		count: 1,
		see_also: [],
		status: "pending",
		recurrence_key: "",
	};
	lesson.recurrence_key = recurrenceKey(lesson);
	return { lesson };
}

export function recurrenceKey(lesson: Pick<Lesson, "domain" | "category" | "area" | "rule">): string {
	const rule = lesson.rule.toLowerCase().replace(/\s+/g, " ").trim();
	const digest = createHash("sha256").update(rule).digest("hex").slice(0, 12);
	return `${lesson.domain}|${lesson.category ?? ""}|${lesson.area ?? ""}|${digest}`;
}

export function lessonIsBlocked(lesson: Lesson, pattern: LessonPattern | undefined): boolean {
	const text = [
		lesson.trigger,
		lesson.mistake,
		lesson.rule,
		lesson.before,
		lesson.after,
		...Object.values(lesson.fields ?? {}),
	]
		.filter(Boolean)
		.join("\n");
	const patterns = [...GLOBAL_REDACT, ...(pattern?.redact ?? [])];
	return patterns.some((item) => item.test(text));
}

export function lessonIsOffered(lesson: Lesson, pattern: LessonPattern): boolean {
	const count = lesson.count ?? 1;
	if (count >= pattern.promotionThreshold.count) return true;
	return Boolean(pattern.promotionThreshold.severity && lesson.severity === pattern.promotionThreshold.severity);
}

export function repairLessonPrompt(pattern: LessonPattern, reason: string): string {
	return [
		"Repair this lesson. The previous reply was rejected.",
		`Reason: ${reason}`,
		"Reply with JSON only. No preamble.",
		`category must be one of: ${pattern.categories.join(", ")}.`,
		pattern.areas.length > 0 ? `area must be one of: ${pattern.areas.join(", ")}.` : "Omit area.",
		pattern.beforeAfter ? "before and after are required." : "before and after are optional.",
		"Do not include an account number, a key, or a secret.",
	].join("\n");
}

export function formatLessonPattern(pattern: LessonPattern): string {
	const raised = Object.entries(pattern.severity)
		.filter(([key]) => key !== "default")
		.map(([key, value]) => `${key} ${value}`);
	const fields =
		pattern.fields.map((field) => (field.required ? `${field.name} required` : field.name)).join(", ") || "(none)";
	const never = pattern.redact.map((item) => item.source).join(" | ") || "(none)";
	const lines = [
		`domain: ${pattern.domain}`,
		`categories: ${pattern.categories.join(", ")}`,
		`areas: ${pattern.areas.length > 0 ? pattern.areas.join(", ") : "(none)"}`,
		`before_after: ${pattern.beforeAfter ? "required" : "optional"}`,
		`severity: ${raised.join(", ") || pattern.severity.default || "medium"}`,
		`fields: ${fields}`,
		`promotion: count >= ${pattern.promotionThreshold.count}${pattern.promotionThreshold.severity ? ` or severity ${pattern.promotionThreshold.severity}` : ""}`,
		`promotion targets: ${pattern.promotionTargets.map((target) => `${target.id} (${target.title})`).join(", ") || "(none)"}`,
		`never store: ${never}`,
		"Keys and private keys are always refused.",
	];
	return lines.join("\n");
}

/** Overlay YAML when the project has one, otherwise the bundled file. */
export function readLessonPatternYaml(cwd: string, id: string): string {
	if (!ID_PATTERN.test(id)) throw new Error("domain id must be lowercase letters, numbers, and hyphens");
	const overlay = join(cwd, ".trek", "domains", id, "lessons.yaml");
	if (existsSync(overlay)) return readFileSync(overlay, "utf8");
	const bundled = join(bundledLessonRoot(), id, "lessons.yaml");
	if (existsSync(bundled)) return readFileSync(bundled, "utf8");
	throw new Error(`no lesson pattern for ${id}`);
}

export interface SavedLessonPattern {
	backedUp: boolean;
}

/** Write `.trek/domains/<id>/lessons.yaml`. The bundled file is never overwritten. */
export function saveLessonOverlay(
	cwd: string,
	id: string,
	yamlText: string,
	previousText?: string,
): SavedLessonPattern {
	if (!ID_PATTERN.test(id)) throw new Error("domain id must be lowercase letters, numbers, and hyphens");
	const pattern = parseLessonPattern(yamlText, id);
	if (!pattern) throw new Error(`${id} lessons.yaml is not a valid pattern`);
	const text = yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`;
	const dir = join(cwd, ".trek", "domains", id);
	const file = join(dir, "lessons.yaml");
	mkdirSync(dir, { recursive: true });
	let backedUp = false;
	if (!existsSync(file) && previousText && previousText.trim() !== text.trim()) {
		writeFileSync(file, previousText.endsWith("\n") ? previousText : `${previousText}\n`);
	}
	if (existsSync(file)) {
		const current = readFileSync(file, "utf8");
		if (current.trim() === text.trim()) {
			clearLessonPatternCache();
			return { backedUp: false };
		}
		backupLessonFile(dir, current, text);
		backedUp = true;
	}
	writeFileSync(file, text);
	clearLessonPatternCache();
	return { backedUp };
}

export function restoreLessonOverlay(cwd: string, id: string): void {
	if (!ID_PATTERN.test(id)) throw new Error("domain id must be lowercase letters, numbers, and hyphens");
	const dir = join(cwd, ".trek", "domains", id);
	const history = join(dir, "history", "lessons");
	const index = readHistory(history);
	if (!index || index.at <= 0) throw new Error(`no previous ${id} lessons.yaml`);
	index.at -= 1;
	const yaml = readFileSync(join(history, index.order[index.at] ?? ""), "utf8");
	if (!parseLessonPattern(yaml, id)) throw new Error(`${id} lessons.yaml is not a valid pattern`);
	writeFileSync(join(dir, "lessons.yaml"), yaml.endsWith("\n") ? yaml : `${yaml}\n`);
	writeHistory(history, index);
	clearLessonPatternCache();
}

export function writeDomainSkill(cwd: string, domain: string, targetId: string, title: string, body: string): string {
	const safe =
		targetId
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "skill";
	const path = join(cwd, ".trek", "domains", domain, "skills", `${safe}.md`);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `# ${title}\n\n${body.trim()}\n`);
	return path;
}

/** Skill files for the selected domain only. Capped so a long file cannot fill the prompt. */
export function readDomainSkills(cwd: string, domain: string, limit = 2000): string {
	if (!domain || domain === "none" || !ID_PATTERN.test(domain)) return "";
	const dir = join(cwd, ".trek", "domains", domain, "skills");
	if (!existsSync(dir)) return "";
	const parts: string[] = [];
	for (const name of readdirSync(dir)
		.filter((item) => item.endsWith(".md"))
		.sort()) {
		try {
			parts.push(readFileSync(join(dir, name), "utf8").trim());
		} catch {
			// A missing skill must not fail the turn.
		}
	}
	return parts.join("\n\n").slice(0, limit);
}

function patternStamp(cwd: string, bundledRoot: string): string {
	const stamps: string[] = [];
	for (const root of [bundledRoot, join(cwd, ".trek", "domains")]) {
		if (!existsSync(root)) continue;
		for (const domain of readDomainIds(root)) {
			const file = join(root, domain, "lessons.yaml");
			if (!existsSync(file)) continue;
			try {
				stamps.push(`${file}:${statSync(file).mtimeMs}`);
			} catch {
				stamps.push(file);
			}
		}
	}
	return stamps.join("|");
}

function readDomainIds(root: string): string[] {
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => ID_PATTERN.test(name))
			.sort();
	} catch {
		return [];
	}
}

function readPatternFile(file: string, domain: string): LessonPattern | undefined {
	try {
		return parseLessonPattern(readFileSync(file, "utf8"), domain);
	} catch {
		return undefined;
	}
}

function parseLessonPattern(yamlText: string, expected: string): LessonPattern | undefined {
	let raw: unknown;
	try {
		raw = parse(yamlText);
	} catch {
		return undefined;
	}
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const domain = typeof record.domain === "string" ? record.domain : "";
	if (domain !== expected || !ID_PATTERN.test(domain)) return undefined;
	const categories = stringList(record.categories);
	if (categories.length === 0) return undefined;
	const areas = stringList(record.areas);
	const severity = severityMap(record.severity);
	const targets = promotionTargets(record.promotion_targets);
	const threshold = record.promotion_threshold;
	const count =
		threshold && typeof threshold === "object" && typeof (threshold as { count?: unknown }).count === "number"
			? (threshold as { count: number }).count
			: 3;
	const thresholdSeverity =
		threshold && typeof threshold === "object"
			? asSeverity((threshold as { severity?: unknown }).severity)
			: undefined;
	const fields = patternFields(record.fields);
	return {
		domain,
		categories,
		areas,
		severity,
		beforeAfter: record.before_after === true,
		fields,
		promotionTargets: targets,
		promotionThreshold: { count: count > 0 ? count : 3, severity: thresholdSeverity },
		redact: redactList(record.redact),
	};
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string" && ID_PATTERN.test(item));
}

function severityMap(value: unknown): Record<string, LessonSeverity> {
	const map: Record<string, LessonSeverity> = { default: "medium" };
	if (!value || typeof value !== "object") return map;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		const severity = asSeverity(item);
		if (severity) map[key] = severity;
	}
	return map;
}

function promotionTargets(value: unknown): Array<{ id: string; title: string }> {
	if (!Array.isArray(value)) return [];
	const targets: Array<{ id: string; title: string }> = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const id = (item as { id?: unknown }).id;
		const title = (item as { title?: unknown }).title;
		if (typeof id === "string" && ID_PATTERN.test(id) && typeof title === "string" && title.trim()) {
			targets.push({ id, title: title.trim() });
		}
	}
	return targets;
}

function patternFields(value: unknown): Array<{ name: string; required: boolean }> {
	if (!Array.isArray(value)) return [];
	const fields: Array<{ name: string; required: boolean }> = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const name = (item as { name?: unknown }).name;
		if (typeof name !== "string" || !ID_PATTERN.test(name)) continue;
		fields.push({ name, required: (item as { required?: unknown }).required === true });
	}
	return fields;
}

function redactList(value: unknown): RegExp[] {
	if (!Array.isArray(value)) return [];
	const patterns: RegExp[] = [];
	for (const item of value) {
		if (typeof item !== "string" || item.length === 0 || item.length > 200) continue;
		try {
			patterns.push(new RegExp(item, "i"));
		} catch {
			// A bad overlay regex is ignored rather than failing the turn.
		}
	}
	return patterns;
}

function asSeverity(value: unknown): LessonSeverity | undefined {
	return value === "low" || value === "medium" || value === "high" || value === "critical" ? value : undefined;
}

function clampSeverity(given: string, floor: LessonSeverity): LessonSeverity {
	const parsed = asSeverity(given) ?? floor;
	return SEVERITY_RANK[parsed] < SEVERITY_RANK[floor] ? floor : parsed;
}

function jsonRecord(text: string): Record<string, unknown> | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function textField(record: Record<string, unknown>, name: string): string {
	const value = record[name];
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

interface HistoryIndex {
	order: string[];
	at: number;
}

function backupLessonFile(dir: string, previous: string, next: string): void {
	const history = join(dir, "history", "lessons");
	mkdirSync(history, { recursive: true });
	const index = readHistory(history) ?? { order: [], at: 0 };
	if (index.order.length === 0) {
		index.order.push(writeHistoryFile(history, previous));
		index.at = 0;
	}
	const kept = index.at + 1;
	for (const name of index.order.slice(kept)) {
		const path = join(history, name);
		if (existsSync(path)) unlinkSync(path);
	}
	index.order = index.order.slice(0, kept);
	index.order.push(writeHistoryFile(history, next));
	index.at = index.order.length - 1;
	writeHistory(history, index);
}

function writeHistoryFile(dir: string, text: string): string {
	const stamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
	let file = `${stamp}-lessons.yaml`;
	let n = 1;
	while (existsSync(join(dir, file))) {
		n += 1;
		file = `${stamp}-lessons-${n}.yaml`;
	}
	writeFileSync(join(dir, file), text.endsWith("\n") ? text : `${text}\n`);
	return file;
}

function readHistory(dir: string): HistoryIndex | undefined {
	try {
		const raw = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Partial<HistoryIndex>;
		if (!raw || !Array.isArray(raw.order) || typeof raw.at !== "number") return undefined;
		const order = raw.order.filter((item) => typeof item === "string");
		if (raw.at < 0 || raw.at >= order.length) return undefined;
		return { order, at: raw.at };
	} catch {
		return undefined;
	}
}

function writeHistory(dir: string, index: HistoryIndex): void {
	writeFileSync(join(dir, "index.json"), `${JSON.stringify(index, null, "\t")}\n`);
}
