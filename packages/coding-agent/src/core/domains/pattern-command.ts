/**
 * List and edit a domain lesson pattern.
 * Edits are written to `.trek/domains/<id>/lessons.yaml`. The bundled file stays as it shipped.
 */

import { parse, stringify } from "yaml";
import {
	formatLessonPattern,
	lessonPatternFor,
	readLessonPatternYaml,
	restoreLessonOverlay,
	saveLessonOverlay,
	warmLessonPatterns,
} from "./lesson-pattern.ts";

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,60}$/;
const SEVERITY = new Set(["low", "medium", "high", "critical"]);

const USAGE = [
	"usage:",
	"  /patterns",
	"  /patterns <id>",
	"  /patterns edit <id> categories add|remove <name>",
	"  /patterns edit <id> areas add|remove <name>",
	"  /patterns edit <id> targets add <id> <title>",
	"  /patterns edit <id> targets remove <id>",
	"  /patterns edit <id> never add|remove <pattern>",
	"  /patterns edit <id> severity <category> <low|medium|high|critical>",
	"  /patterns edit <id> threshold <count> [severity]",
	"  /patterns edit <id> before_after required|optional",
	"  /patterns edit <id> fields add <name> [required]",
	"  /patterns edit <id> fields remove <name>",
	"  /patterns restore <id>",
	"The bundled pattern is not overwritten.",
].join("\n");

type Section = "categories" | "areas" | "targets" | "never" | "severity" | "threshold" | "before_after" | "fields";

export function runPatternCommand(cwd: string, arg: string): string {
	const parts = splitArgs(arg);
	const sub = parts[0] ?? "";
	try {
		if (sub === "" || sub === "list") return formatPatternList(cwd);
		if (sub === "help" || sub === "--help" || sub === "-h") return USAGE;
		if (sub === "restore") return restorePattern(cwd, parts[1]);
		if (sub === "show") return showPattern(cwd, parts[1]);
		if (sub === "edit") return editPattern(cwd, parts.slice(1));
		if (parts.length === 1 && ID_PATTERN.test(sub)) return showPattern(cwd, sub);
		return USAGE;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function completePatternCommand(
	cwd: string,
	argumentPrefix: string,
): Array<{ value: string; label: string; description?: string }> {
	const text = argumentPrefix.trimStart();
	const tokens = text.split(/\s+/).filter((part) => part.length > 0);
	const open = text.endsWith(" ");
	const partial = open ? "" : (tokens.pop() ?? "");
	const done = tokens;
	const domains = [...warmLessonPatterns(cwd).keys()].sort();
	if (done.length === 0) {
		return [
			...["list", "show", "edit", "restore"].map((item) => ({ value: item, label: item })),
			...domains.map((id) => ({ value: id, label: id, description: "show" })),
		].filter((item) => item.label.startsWith(partial));
	}
	if (done[0] === "show" || done[0] === "restore") {
		if (done.length > 1) return [];
		return domains.filter((id) => id.startsWith(partial)).map((id) => ({ value: `${done[0]} ${id}`, label: id }));
	}
	if (done[0] !== "edit") return [];
	if (done.length === 1) {
		return domains.filter((id) => id.startsWith(partial)).map((id) => ({ value: `edit ${id}`, label: id }));
	}
	if (done.length === 2) {
		return ["categories", "areas", "targets", "never", "severity", "threshold", "before_after", "fields"]
			.filter((item) => item.startsWith(partial))
			.map((item) => ({ value: `edit ${done[1]} ${item}`, label: item }));
	}
	const section = sectionOf(done[2] ?? "");
	if (!section || done.length > 3) return [];
	const actions =
		section === "before_after"
			? ["required", "optional"]
			: section === "severity" || section === "threshold"
				? []
				: ["add", "remove"];
	return actions
		.filter((item) => item.startsWith(partial))
		.map((item) => ({ value: `edit ${done[1]} ${done[2]} ${item}`, label: item }));
}

function formatPatternList(cwd: string): string {
	const patterns = [...warmLessonPatterns(cwd).values()].sort((a, b) => a.domain.localeCompare(b.domain));
	if (patterns.length === 0) return "No lesson patterns.";
	const rows = patterns.map((pattern) => [
		pattern.domain,
		pattern.categories.join(", "),
		pattern.promotionTargets.map((target) => target.title).join(", ") || "(none)",
		pattern.redact.map((item) => item.source).join(" | ") || "(none)",
	]);
	return renderTextTable(["domain", "categories", "promotion targets", "never store"], rows, [16, 36, 28, 24]);
}

function showPattern(cwd: string, id: string | undefined): string {
	requireId(id);
	const pattern = lessonPatternFor(cwd, id);
	if (!pattern) throw new Error(`no lesson pattern for ${id}`);
	return formatLessonPattern(pattern);
}

function restorePattern(cwd: string, id: string | undefined): string {
	requireId(id);
	restoreLessonOverlay(cwd, id);
	return `Restored ${id}.\n${showPattern(cwd, id)}`;
}

function editPattern(cwd: string, parts: string[]): string {
	const id = parts[0];
	requireId(id);
	const section = sectionOf(parts[1] ?? "");
	if (!section) return USAGE;
	const current = readLessonPatternYaml(cwd, id);
	const parsed = parse(current);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${id} lessons.yaml is not a valid pattern`);
	}
	const doc = parsed as Record<string, unknown>;
	applyEdit(doc, section, parts.slice(2));
	doc.domain = id;
	const next = stringify(doc, { lineWidth: 0 });
	const saved = saveLessonOverlay(cwd, id, next, current);
	const shown = showPattern(cwd, id);
	if (!saved.backedUp) return `${id} is unchanged.\n${shown}`;
	return `Saved .trek/domains/${id}/lessons.yaml. The bundled pattern is unchanged.\n${shown}`;
}

function applyEdit(doc: Record<string, unknown>, section: Section, args: string[]): void {
	if (section === "categories" || section === "areas") {
		editNameList(doc, section, args);
		return;
	}
	if (section === "targets") {
		editTargets(doc, args);
		return;
	}
	if (section === "never") {
		editNever(doc, args);
		return;
	}
	if (section === "severity") {
		editSeverity(doc, args);
		return;
	}
	if (section === "threshold") {
		editThreshold(doc, args);
		return;
	}
	if (section === "before_after") {
		const value = args[0];
		if (value !== "required" && value !== "optional") throw new Error("before_after is required or optional");
		doc.before_after = value === "required";
		return;
	}
	editFields(doc, args);
}

function editNameList(doc: Record<string, unknown>, key: "categories" | "areas", args: string[]): void {
	const action = args[0];
	const name = args[1];
	if ((action !== "add" && action !== "remove") || !name || args.length !== 2) {
		throw new Error(`usage: /patterns edit <id> ${key} add|remove <name>`);
	}
	requireName(name);
	const list = stringList(doc, key);
	if (action === "add") {
		if (list.includes(name)) throw new Error(`${name} is already in ${key}`);
		list.push(name);
		return;
	}
	const next = list.filter((item) => item !== name);
	if (next.length === list.length) throw new Error(`${name} is not in ${key}`);
	if (key === "categories" && next.length === 0) throw new Error("a pattern needs one category");
	doc[key] = next;
}

function editTargets(doc: Record<string, unknown>, args: string[]): void {
	const action = args[0];
	const id = args[1];
	const targets = targetList(doc);
	if (action === "remove") {
		if (!id || args.length !== 2) throw new Error("usage: /patterns edit <id> targets remove <id>");
		requireName(id);
		const next = targets.filter((item) => item.id !== id);
		if (next.length === targets.length) throw new Error(`${id} is not a promotion target`);
		doc.promotion_targets = next;
		return;
	}
	if (action !== "add" || !id || args.length < 3) {
		throw new Error("usage: /patterns edit <id> targets add <id> <title>");
	}
	requireName(id);
	if (targets.some((item) => item.id === id)) throw new Error(`${id} is already a promotion target`);
	const title = args.slice(2).join(" ").trim();
	if (!title) throw new Error("a promotion target needs a title");
	targets.push({ id, title });
}

function editNever(doc: Record<string, unknown>, args: string[]): void {
	const action = args[0];
	const source = args.slice(1).join(" ").trim();
	if ((action !== "add" && action !== "remove") || !source) {
		throw new Error("usage: /patterns edit <id> never add|remove <pattern>");
	}
	if (source.length > 200) throw new Error("a never-store pattern must be 200 characters or fewer");
	const list = stringList(doc, "redact");
	if (action === "remove") {
		const next = list.filter((item) => item !== source);
		if (next.length === list.length) throw new Error("that pattern is not in never store");
		doc.redact = next;
		return;
	}
	try {
		new RegExp(source, "i");
	} catch {
		throw new Error("that never-store pattern is not a valid regular expression");
	}
	if (list.includes(source)) throw new Error("that pattern is already in never store");
	list.push(source);
}

function editSeverity(doc: Record<string, unknown>, args: string[]): void {
	const category = args[0];
	const severity = args[1];
	if (!category || !severity || args.length !== 2 || !SEVERITY.has(severity)) {
		throw new Error("usage: /patterns edit <id> severity <category> <low|medium|high|critical>");
	}
	if (category !== "default") requireName(category);
	const categories = stringList(doc, "categories");
	if (category !== "default" && !categories.includes(category)) {
		throw new Error(`${category} is not a category`);
	}
	const map = recordOf(doc, "severity");
	map[category] = severity;
}

function editThreshold(doc: Record<string, unknown>, args: string[]): void {
	const count = Number(args[0]);
	const severity = args[1];
	if (!Number.isInteger(count) || count < 1 || count > 99 || args.length > 2) {
		throw new Error("usage: /patterns edit <id> threshold <count> [severity]");
	}
	if (severity && severity !== "none" && !SEVERITY.has(severity)) {
		throw new Error("severity is low, medium, high, or critical");
	}
	const current = recordOf(doc, "promotion_threshold");
	current.count = count;
	if (severity === "none") delete current.severity;
	else if (severity) current.severity = severity;
}

function editFields(doc: Record<string, unknown>, args: string[]): void {
	const action = args[0];
	const name = args[1];
	const fields = fieldList(doc);
	if (action === "remove") {
		if (!name || args.length !== 2) throw new Error("usage: /patterns edit <id> fields remove <name>");
		requireName(name);
		const next = fields.filter((item) => item.name !== name);
		if (next.length === fields.length) throw new Error(`${name} is not a field`);
		doc.fields = next;
		return;
	}
	if (action !== "add" || !name || args.length > 3) {
		throw new Error("usage: /patterns edit <id> fields add <name> [required]");
	}
	requireName(name);
	if (args[2] && args[2] !== "required") throw new Error("usage: /patterns edit <id> fields add <name> [required]");
	if (fields.some((item) => item.name === name)) throw new Error(`${name} is already a field`);
	fields.push({ name, required: args[2] === "required" });
}

function sectionOf(token: string): Section | undefined {
	if (token === "category") return "categories";
	if (token === "area") return "areas";
	if (token === "target" || token === "promotion" || token === "prompts" || token === "prompt") return "targets";
	if (token === "redact" || token === "never-store") return "never";
	if (
		token === "categories" ||
		token === "areas" ||
		token === "targets" ||
		token === "never" ||
		token === "severity" ||
		token === "threshold" ||
		token === "before_after" ||
		token === "fields"
	) {
		return token;
	}
	return undefined;
}

function stringList(doc: Record<string, unknown>, key: string): string[] {
	const value = doc[key];
	if (!Array.isArray(value)) {
		const created: string[] = [];
		doc[key] = created;
		return created;
	}
	const list = value.filter((item): item is string => typeof item === "string");
	doc[key] = list;
	return list;
}

function targetList(doc: Record<string, unknown>): Array<{ id: string; title: string }> {
	const value = doc.promotion_targets;
	if (!Array.isArray(value)) {
		const created: Array<{ id: string; title: string }> = [];
		doc.promotion_targets = created;
		return created;
	}
	const list = value.filter((item): item is { id: string; title: string } => {
		if (!item || typeof item !== "object") return false;
		const id = (item as { id?: unknown }).id;
		const title = (item as { title?: unknown }).title;
		return typeof id === "string" && typeof title === "string";
	});
	doc.promotion_targets = list;
	return list;
}

function fieldList(doc: Record<string, unknown>): Array<{ name: string; required: boolean }> {
	const value = doc.fields;
	if (!Array.isArray(value)) {
		const created: Array<{ name: string; required: boolean }> = [];
		doc.fields = created;
		return created;
	}
	const list = value.filter((item): item is { name: string; required: boolean } => {
		if (!item || typeof item !== "object") return false;
		return typeof (item as { name?: unknown }).name === "string";
	});
	doc.fields = list;
	return list;
}

function recordOf(doc: Record<string, unknown>, key: string): Record<string, unknown> {
	const value = doc[key];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		const created: Record<string, unknown> = {};
		doc[key] = created;
		return created;
	}
	return value as Record<string, unknown>;
}

function requireId(id: string | undefined): asserts id is string {
	if (!id || !ID_PATTERN.test(id)) throw new Error("usage: /patterns <id>");
}

function requireName(name: string): void {
	if (!ID_PATTERN.test(name)) throw new Error(`${name} must be lowercase letters, numbers, hyphens, or underscores`);
}

function splitArgs(arg: string): string[] {
	return arg
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
}

function renderTextTable(headers: string[], rows: string[][], maxWidths: number[]): string {
	const widths = headers.map((header, index) => {
		const natural = Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length));
		const cap = maxWidths[index];
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
