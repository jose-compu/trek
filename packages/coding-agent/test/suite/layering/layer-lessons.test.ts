/**
 * 0.18-B: domain lessons on layered roles.
 * Run: npx vitest run test/suite/layering/layer-lessons.test.ts test/domain-lessons.test.ts --reporter=verbose
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@trek/ai";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	actingLessonRole,
	detectMetaLessonTrigger,
	META_LAYER_TRIGGERS,
	retagRecallForRole,
	tagRecallForRole,
} from "../../../src/core/domains/layer-lessons.ts";
import { acceptTypedLesson, lessonAllowed, lessonPatternFor } from "../../../src/core/domains/lesson-pattern.ts";
import { listLessonRecords, saveLessonRecord } from "../../../src/core/reflective-loop/crystallize.ts";
import { createHarness, type Harness } from "../../suite/harness.ts";

const FINANCE = {
	trigger: "reconciliation break",
	mistake: "posted the entry before the break was named",
	rule: "Name the account and the period before proposing an entry.",
	category: "reconciliation_error",
	area: "accounting",
	severity: "high" as const,
	before: "The entry was posted.",
	after: "The entry stays a proposal.",
	layer_role: "workhorse",
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

describe("layer lessons", () => {
	it("adds meta layering triggers without rewriting the twenty domain files", () => {
		const meta = lessonPatternFor(process.cwd(), "meta");
		expect(meta?.categories).toEqual(expect.arrayContaining([...META_LAYER_TRIGGERS]));
		expect(lessonPatternFor(process.cwd(), "finance")?.categories).not.toContain("over_escalate");
	});

	it("records optional layer_role on a typed lesson", () => {
		const pattern = lessonPatternFor(process.cwd(), "finance")!;
		const lesson = acceptTypedLesson(JSON.stringify(FINANCE), pattern).lesson!;
		expect(lesson.domain).toBe("finance");
		expect(lesson.category).toBe("reconciliation_error");
		expect(lesson.layer_role).toBe("workhorse");
	});

	it("detects over_escalate and over_think on a climb that should have stayed on Workhorse", () => {
		expect(
			detectMetaLessonTrigger({
				task: "Fix a typo. Escalate to planning. Should have stayed on Workhorse.",
				action: "escalate",
			}),
		).toBe("over_escalate");
		expect(detectMetaLessonTrigger({ task: "Fix a typo.", action: "escalate" })).toBeUndefined();
		expect(
			detectMetaLessonTrigger({
				task: "Fix a typo.",
				correction: "Wrong. Should have stayed on Workhorse.",
			}),
		).toBe("over_escalate");
		expect(detectMetaLessonTrigger({ task: "over-think a one-line rename", thinking: "deep" })).toBe("over_think");
		expect(detectMetaLessonTrigger({ task: "one-line rename", thinking: "deep" })).toBeUndefined();
		expect(tagRecallForRole("<memory>\nRule: x\n</memory>", "planning")).toContain('role="planning"');
		expect(retagRecallForRole('<memory role="workhorse">\nRule: x\n</memory>', "planning")).toContain(
			'role="planning"',
		);
		expect(actingLessonRole("planning")).toBe("planning");
		expect(actingLessonRole("decision")).toBe("workhorse");
	});

	it("does not treat a layer workflow name as a meta lesson by itself", () => {
		expect(
			detectMetaLessonTrigger({
				task: "Examine the reconciliation break.",
				layerWorkflow: "layer-verify",
			}),
		).toBeUndefined();
		expect(
			detectMetaLessonTrigger({
				task: "Examine the reconciliation break.",
				layerWorkflow: "layer-budget-stop",
			}),
		).toBeUndefined();
		expect(
			detectMetaLessonTrigger({ task: "Search the logs.", layerWorkflow: "layer-tool-runners" }),
		).toBeUndefined();
		expect(
			detectMetaLessonTrigger({
				task: "Examine the reconciliation break.",
				layerWorkflow: "layer-verify",
				verifierDenied: true,
			}),
		).toBe("verifier_reject");
		expect(
			detectMetaLessonTrigger({
				task: "Examine the reconciliation break.",
				budgetStopped: true,
			}),
		).toBe("budget_stop");
		expect(detectMetaLessonTrigger({ task: "missed grep on the symbol", layerWorkflow: "layer-tool-runners" })).toBe(
			"runner_miss",
		);
	});

	it("does not recall a finance lesson on a robotics turn; Meta and Security still apply", () => {
		const ids = new Set(["finance", "robotics", "security", "meta"]);
		const always = new Set(["meta", "ai", "security", "engineering"]);
		expect(lessonAllowed("finance", "robotics", ids, always)).toBe(false);
		expect(lessonAllowed("security", "robotics", ids, always)).toBe(true);
		expect(lessonAllowed("meta", "robotics", ids, always)).toBe(true);
	});
});

describe("layered session lessons", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("writes a finance reconciliation_error lesson from a layered turn", async () => {
		const created = await createHarness({ enableLessons: true });
		harnesses.push(created);
		project(created);
		created.setResponses(
			Array.from({ length: 8 }, () => (context: Context) => {
				const side = context.systemPrompt?.includes("Trek learning step") ?? false;
				const prompt = firstUserText(context);
				if (side && prompt.startsWith("Write one lesson")) return fauxAssistantMessage(JSON.stringify(FINANCE));
				if (side && prompt.startsWith("Repair this lesson")) return fauxAssistantMessage(JSON.stringify(FINANCE));
				if (side && prompt.startsWith("Choose the stored lessons")) return fauxAssistantMessage('{"ids": []}');
				const last = context.messages[context.messages.length - 1];
				if (last?.role === "toolResult") return fauxAssistantMessage("The read failed.");
				return fauxAssistantMessage([fauxToolCall("read", { path: "missing-ledger.txt" })], {
					stopReason: "toolUse",
				});
			}),
		);
		await created.session.prompt("Examine the reconciliation break.");
		const rows = listLessonRecords(created.tempDir);
		expect(rows[0]).toMatchObject({
			domain: "finance",
			category: "reconciliation_error",
			layer_role: "workhorse",
		});
	});

	it("captures over_escalate on a meta pattern after a needless climb", async () => {
		const created = await createHarness({ enableLessons: true });
		harnesses.push(created);
		project(created);
		const metaLesson = {
			trigger: "needless climb",
			mistake: "escalated a typo",
			rule: "Stay on Workhorse for a one-line rename.",
			category: "over_escalate",
			area: "agent_config",
			severity: "medium",
		};
		created.setResponses(
			Array.from({ length: 8 }, () => (context: Context) => {
				const side = context.systemPrompt?.includes("Trek learning step") ?? false;
				const prompt = firstUserText(context);
				if (side && (prompt.startsWith("Write one lesson") || prompt.startsWith("Repair this lesson"))) {
					return fauxAssistantMessage(JSON.stringify(metaLesson));
				}
				if (side && prompt.startsWith("Choose the stored lessons")) return fauxAssistantMessage('{"ids": []}');
				const last = context.messages[context.messages.length - 1];
				if (last?.role === "toolResult") return fauxAssistantMessage("failed");
				return fauxAssistantMessage([fauxToolCall("read", { path: "missing.txt" })], { stopReason: "toolUse" });
			}),
		);
		await created.session.prompt("Fix a typo. Escalate to planning. Should have stayed on Workhorse.");
		expect(listLessonRecords(created.tempDir)[0]).toMatchObject({
			domain: "meta",
			category: "over_escalate",
		});
	});

	it("writes meta over_escalate from a correction about a needless climb", async () => {
		const created = await createHarness({ enableLessons: true });
		harnesses.push(created);
		project(created);
		const metaLesson = {
			trigger: "needless climb",
			mistake: "escalated a typo",
			rule: "Stay on Workhorse for a one-line rename.",
			category: "over_escalate",
			area: "agent_config",
			severity: "medium",
		};
		created.setResponses(
			Array.from({ length: 16 }, () => (context: Context) => {
				const side = context.systemPrompt?.includes("Trek learning step") ?? false;
				const prompt = firstUserText(context);
				if (side && (prompt.startsWith("Write one lesson") || prompt.startsWith("Repair this lesson"))) {
					return fauxAssistantMessage(JSON.stringify(metaLesson));
				}
				if (side && prompt.startsWith("Choose the stored lessons")) return fauxAssistantMessage('{"ids": []}');
				const last = context.messages[context.messages.length - 1];
				if (last?.role === "toolResult") return fauxAssistantMessage("failed");
				return fauxAssistantMessage("The rename is done.");
			}),
		);
		await created.session.prompt("Fix a typo.");
		await created.session.prompt("Wrong. Should have stayed on Workhorse.");
		expect(listLessonRecords(created.tempDir)).toEqual(
			expect.arrayContaining([expect.objectContaining({ domain: "meta", category: "over_escalate" })]),
		);
	});

	it("offers L1 only after confirm, including after layer-cooldown", async () => {
		const created = await createHarness({ enableLessons: true });
		harnesses.push(created);
		project(created);
		saveLessonRecord(created.tempDir, "project:4", {
			...FINANCE,
			domain: "finance",
			count: 3,
			status: "pending",
			recurrence_key: "finance|reconciliation_error|accounting|cooldown",
		});
		created.session.setToolConfirmHandler(() => false);
		created.setResponses([
			() =>
				fauxAssistantMessage(
					JSON.stringify({ promote: "yes", reason: "It recurs.", skill: "Name the break before posting." }),
				),
		]);
		const denied = await created.session.crystallizeLesson("project:4");
		expect(denied).toMatch(/yes|confirm|Nothing was written|needs/i);
		expect(existsSync(join(created.tempDir, ".trek", "domains", "finance", "skills", "close-checklist.md"))).toBe(
			false,
		);
		created.session.setToolConfirmHandler(() => true);
		created.setResponses([
			() =>
				fauxAssistantMessage(
					JSON.stringify({ promote: "yes", reason: "It recurs.", skill: "Name the break before posting." }),
				),
		]);
		const written = await created.session.crystallizeLesson("project:4");
		expect(written).toContain(".trek/domains/finance/skills/");
	});
});
