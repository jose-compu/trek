/**
 * 0.15.0 domain lessons. No live model.
 * Run: PI_NO_LOCAL_LLM=1 npx vitest run test/domain-lessons.test.ts test/lessons.test.ts test/crystallize.test.ts --reporter=verbose
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@trek/ai";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { bundledDomainsRoot } from "../src/core/domains/catalog.ts";
import {
	acceptTypedLesson,
	clearLessonPatternCache,
	lessonAllowed,
	lessonIsBlocked,
	lessonIsOffered,
	lessonPatternFor,
	restoreLessonOverlay,
	saveLessonOverlay,
	warmLessonPatterns,
} from "../src/core/domains/lesson-pattern.ts";
import { runPatternCommand } from "../src/core/domains/pattern-command.ts";
import { listLessonRecords, loadLessonRecord, saveLessonRecord } from "../src/core/reflective-loop/crystallize.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const FINANCE = {
	trigger: "reconciliation break",
	mistake: "posted the entry before the break was named",
	rule: "Name the account and the period before proposing an entry.",
	category: "reconciliation_error",
	area: "accounting",
	severity: "high" as const,
	before: "The entry was posted.",
	after: "The entry stays a proposal.",
};

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function firstUserText(context: Context): string {
	const first = context.messages.find((message) => message.role === "user");
	return first ? textOf(first.content) : "";
}

function project(harness: Harness): void {
	mkdirSync(join(harness.tempDir, ".git"), { recursive: true });
	writeFileSync(join(harness.tempDir, "package.json"), "{}\n");
}

describe("lesson patterns", () => {
	it("parses all twenty bundled files", () => {
		const root = bundledDomainsRoot();
		const ids = readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		expect(ids).toHaveLength(20);
		const patterns = warmLessonPatterns(process.cwd(), root);
		expect(patterns.size).toBe(20);
		for (const id of ids) {
			const pattern = patterns.get(id);
			expect(pattern?.domain, id).toBe(id);
			expect(pattern?.categories.length, id).toBeGreaterThan(0);
		}
		expect(patterns.get("conversation")?.areas).toEqual([]);
		expect(patterns.get("science")?.areas).toEqual([]);
		expect(patterns.get("finance")?.beforeAfter).toBe(true);
	});

	it("requires a finance category, area, and before/after, and rejects an unknown category", () => {
		const pattern = lessonPatternFor(process.cwd(), "finance");
		expect(pattern).toBeDefined();
		const lesson = acceptTypedLesson(JSON.stringify(FINANCE), pattern!);
		expect(lesson.lesson).toMatchObject({
			domain: "finance",
			category: "reconciliation_error",
			area: "accounting",
			before: "The entry was posted.",
			after: "The entry stays a proposal.",
			severity: "high",
		});
		expect(acceptTypedLesson(JSON.stringify({ ...FINANCE, category: "not_a_category" }), pattern!).reason).toContain(
			"unknown category",
		);
		expect(acceptTypedLesson(JSON.stringify({ ...FINANCE, before: "" }), pattern!).reason).toContain("before");
	});

	it("does not store an account number or a key", () => {
		const pattern = lessonPatternFor(process.cwd(), "finance");
		const account = acceptTypedLesson(JSON.stringify(FINANCE), pattern!).lesson!;
		account.rule = "Post account 123456789 to the suspense account.";
		expect(lessonIsBlocked(account, pattern)).toBe(true);
		const key = { ...account, rule: "The key is sk-abcdefghijklmnop." };
		expect(lessonIsBlocked(key, pattern)).toBe(true);
		expect(lessonIsBlocked(acceptTypedLesson(JSON.stringify(FINANCE), pattern!).lesson!, pattern)).toBe(false);
	});

	it("offers a lesson at the count threshold and not before", () => {
		const pattern = lessonPatternFor(process.cwd(), "finance")!;
		const lesson = acceptTypedLesson(JSON.stringify(FINANCE), pattern).lesson!;
		expect(lessonIsOffered(lesson, pattern)).toBe(false);
		expect(lessonIsOffered({ ...lesson, count: 3 }, pattern)).toBe(true);
	});

	it("keeps a legacy tag and drops a finance tag on a robotics turn", () => {
		const ids = new Set(["finance", "robotics", "security"]);
		const always = new Set(["security"]);
		expect(lessonAllowed("finance", "robotics", ids, always)).toBe(false);
		expect(lessonAllowed("security", "robotics", ids, always)).toBe(true);
		expect(lessonAllowed("deploy", "robotics", ids, always)).toBe(true);
		expect(lessonAllowed(undefined, "robotics", ids, always)).toBe(true);
	});

	it("restores a local lessons.yaml overlay", () => {
		const cwd = join(tmpdir(), `trek-lesson-overlay-${Date.now()}`);
		mkdirSync(join(cwd, ".trek", "domains", "finance"), { recursive: true });
		try {
			const original = readFileSync(join(bundledDomainsRoot(), "finance", "lessons.yaml"), "utf8");
			writeFileSync(join(cwd, ".trek", "domains", "finance", "lessons.yaml"), original);
			clearLessonPatternCache();
			saveLessonOverlay(cwd, "finance", `${original}\n# local\n`);
			expect(readFileSync(join(cwd, ".trek", "domains", "finance", "lessons.yaml"), "utf8")).toContain("# local");
			restoreLessonOverlay(cwd, "finance");
			expect(readFileSync(join(cwd, ".trek", "domains", "finance", "lessons.yaml"), "utf8")).not.toContain(
				"# local",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			clearLessonPatternCache();
		}
	});

	it("lists a pattern and edits categories, targets, and never-store in the overlay", () => {
		const cwd = join(tmpdir(), `trek-pattern-edit-${Date.now()}`);
		mkdirSync(cwd, { recursive: true });
		try {
			clearLessonPatternCache();
			const listed = runPatternCommand(cwd, "");
			expect(listed).toContain("finance");
			expect(listed).toContain("reconciliation_error");
			expect(listed).toContain("close checklist");
			const edited = runPatternCommand(cwd, "edit finance categories add tax_gap");
			expect(edited).toContain("Saved .trek/domains/finance/lessons.yaml");
			expect(lessonPatternFor(cwd, "finance")?.categories).toContain("tax_gap");
			expect(existsSync(join(bundledDomainsRoot(), "finance", "lessons.yaml"))).toBe(true);
			expect(readFileSync(join(bundledDomainsRoot(), "finance", "lessons.yaml"), "utf8")).not.toContain("tax_gap");
			const target = runPatternCommand(cwd, "edit finance targets add sox-memo SOX memo");
			expect(target).toContain("sox-memo");
			const blocked = runPatternCommand(cwd, "edit finance never add west-cistern");
			expect(blocked).toContain("west-cistern");
			const pattern = lessonPatternFor(cwd, "finance");
			const lesson = acceptTypedLesson(JSON.stringify(FINANCE), pattern!).lesson!;
			lesson.rule = "The break is the west-cistern pump.";
			expect(lessonIsBlocked(lesson, pattern)).toBe(true);
			expect(runPatternCommand(cwd, "edit finance never add (")).toContain("not a valid regular expression");
			expect(runPatternCommand(cwd, "edit finance categories remove missing_category")).toContain(
				"is not in categories",
			);
			for (let step = 0; step < 3; step++) {
				expect(runPatternCommand(cwd, "restore finance")).toContain("Restored finance");
			}
			expect(lessonPatternFor(cwd, "finance")?.categories).not.toContain("tax_gap");
			expect(lessonPatternFor(cwd, "finance")?.categories).toContain("reconciliation_error");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			clearLessonPatternCache();
		}
	});
});

describe("typed lessons in a session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function harness(): Promise<Harness> {
		const created = await createHarness({ enableLessons: true });
		harnesses.push(created);
		project(created);
		return created;
	}

	function failedFinance(json: string) {
		return (context: Context) => {
			const side = context.systemPrompt?.includes("Trek learning step") ?? false;
			const prompt = firstUserText(context);
			if (side && prompt.startsWith("Write one lesson")) return fauxAssistantMessage(json);
			if (side && prompt.startsWith("Repair this lesson")) return fauxAssistantMessage(json);
			if (side && prompt.startsWith("Choose the stored lessons")) return fauxAssistantMessage('{"ids": []}');
			if (side && prompt.startsWith("Decide whether")) {
				return fauxAssistantMessage(
					JSON.stringify({ promote: "yes", reason: "It recurs.", skill: "Name the break before posting." }),
				);
			}
			const last = context.messages[context.messages.length - 1];
			if (last?.role === "toolResult") return fauxAssistantMessage("The read failed.");
			return fauxAssistantMessage([fauxToolCall("read", { path: "missing-ledger.txt" })], { stopReason: "toolUse" });
		};
	}

	it("stores one finance lesson and increments count on the same lesson", async () => {
		const created = await harness();
		created.setResponses(Array.from({ length: 8 }, () => failedFinance(JSON.stringify(FINANCE))));
		await created.session.prompt("Examine the reconciliation break.");
		await created.session.prompt("Examine the reconciliation break again.");
		const rows = listLessonRecords(created.tempDir);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ category: "reconciliation_error", area: "accounting", count: 2 });
		expect(created.session.systemPrompt).not.toContain("sk-");
	});

	it("drops an unknown category after one repair", async () => {
		const created = await harness();
		const bad = JSON.stringify({ ...FINANCE, category: "not_a_category" });
		created.setResponses(Array.from({ length: 6 }, () => failedFinance(bad)));
		await created.session.prompt("Examine the reconciliation break.");
		expect(listLessonRecords(created.tempDir)).toEqual([]);
		const dropped = created.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "trek:lesson_dropped");
		expect(dropped.length).toBeGreaterThan(0);
	});

	it("does not recall a finance lesson on a robotics turn, and does recall security", async () => {
		const created = await harness();
		const security = {
			trigger: "cve",
			mistake: "left the port open",
			rule: "Close the unused port.",
			category: "vulnerability",
			area: "network",
			severity: "critical",
		};
		created.setResponses(
			Array.from({ length: 10 }, () => (context: Context) => {
				const side = context.systemPrompt?.includes("Trek learning step") ?? false;
				const prompt = firstUserText(context);
				if (side && prompt.startsWith("Choose the stored lessons")) {
					return fauxAssistantMessage('{"ids": []}');
				}
				if (side && prompt.startsWith("Write one lesson")) {
					const json = prompt.includes("reconciliation break") ? FINANCE : security;
					return fauxAssistantMessage(JSON.stringify(json));
				}
				const last = context.messages[context.messages.length - 1];
				if (last?.role === "toolResult") return fauxAssistantMessage("failed");
				return fauxAssistantMessage([fauxToolCall("read", { path: "missing-ledger.txt" })], {
					stopReason: "toolUse",
				});
			}),
		);
		await created.session.prompt("Examine the reconciliation break.");
		await created.session.prompt("There is a cve in access control.");
		let seen = "";
		created.setResponses([
			(context) => {
				const prompt = firstUserText(context);
				if (
					context.systemPrompt?.includes("Trek learning step") &&
					prompt.startsWith("Choose the stored lessons")
				) {
					seen = prompt;
					return fauxAssistantMessage('{"ids": []}');
				}
				return fauxAssistantMessage("The robot stopped.");
			},
		]);
		await created.session.prompt("The robot failed to localize.");
		expect(seen).not.toContain("Name the account");
		expect(seen).toContain("Close the unused port");
	});

	it("writes a domain skill only after confirm, and only that domain loads it", async () => {
		const created = await harness();
		saveLessonRecord(created.tempDir, "project:9", {
			...FINANCE,
			domain: "finance",
			count: 3,
			status: "pending",
			recurrence_key: "finance|reconciliation_error|accounting|xyz",
		});
		created.session.setToolConfirmHandler(() => true);
		created.setResponses([
			() =>
				fauxAssistantMessage(
					JSON.stringify({ promote: "yes", reason: "It recurs.", skill: "Name the break before posting." }),
				),
		]);
		const early = await created.session.crystallizeLesson("project:8");
		expect(early).toContain("unknown");
		saveLessonRecord(created.tempDir, "project:8", {
			...FINANCE,
			domain: "finance",
			count: 1,
			status: "pending",
		});
		expect(await created.session.crystallizeLesson("project:8")).toContain("below the promotion threshold");
		expect(existsSync(join(created.tempDir, ".trek", "skills", "lessons"))).toBe(false);
		const written = await created.session.crystallizeLesson("project:9");
		expect(written).toContain(".trek/domains/finance/skills/");
		expect(existsSync(join(created.tempDir, ".trek", "domains", "finance", "skills", "close-checklist.md"))).toBe(
			true,
		);
		expect(loadLessonRecord(created.tempDir, "project:9")?.status).toBe("promoted");
		created.setResponses([(context) => fauxAssistantMessage(firstUserText(context) ? "noted" : "noted")]);
		process.env.TREK_LESSON_PROMOTION = "0";
		await created.session.prompt("Examine the reconciliation break.");
		expect(created.session.systemPrompt).toContain("Name the break before posting.");
		await created.session.prompt("The robot failed to localize.");
		expect(created.session.systemPrompt).not.toContain("Name the break before posting.");
	});
});
