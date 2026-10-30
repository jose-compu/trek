/**
 * 0.14.0 crystallization: a skill is written only after a Yes.
 * Run: npx vitest run test/crystallize.test.ts --reporter=verbose
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@trek/ai";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	COMPACTION_LESSON_RULE,
	parseCrystallize,
	skillNameForLesson,
	withLessonIds,
} from "../src/core/reflective-loop/crystallize.ts";
import { NO_PROMOTION_MODEL } from "../src/core/runtime/promotion-model.ts";
import { loadSkills } from "../src/core/skills.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";
import { createHarness, type Harness } from "./suite/harness.ts";
import { createTestResourceLoader } from "./utilities.ts";

const LESSON_JSON = JSON.stringify({
	trigger: "reading the deploy config",
	mistake: "read config.yaml at the root, which does not exist",
	rule: "Read deploy/config.yaml for the deploy settings.",
	domain: "deploy",
});

const YES = JSON.stringify({
	promote: "yes",
	reason: "The rule prevents a missing file.",
	skill: "Read deploy/config.yaml for the deploy settings.",
});

const NO = JSON.stringify({ promote: "no", reason: "The lesson is too narrow." });

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

function skillPath(cwd: string, id: string): string {
	return join(cwd, ".trek", "skills", "lessons", skillNameForLesson(id), "SKILL.md");
}

function customEntries(harness: Harness, type: string): Array<Record<string, unknown>> {
	return harness.sessionManager
		.getEntries()
		.flatMap((entry) =>
			entry.type === "custom" && entry.customType === type ? [entry.data as Record<string, unknown>] : [],
		);
}

describe("crystallize helpers", () => {
	it("parses a yes and a no, and rejects a yes without a skill", () => {
		expect(parseCrystallize(`note\n${YES}`)).toEqual({
			promote: "yes",
			reason: "The rule prevents a missing file.",
			skill: "Read deploy/config.yaml for the deploy settings.",
		});
		expect(parseCrystallize(NO)?.promote).toBe("no");
		expect(parseCrystallize('{"promote": "yes", "reason": "ok"}')).toBeUndefined();
		expect(parseCrystallize("no json")).toBeUndefined();
		expect(skillNameForLesson("project:12")).toBe("project-12");
		expect(withLessonIds("Goal", ["project:12"])).toContain("- project:12");
		expect(COMPACTION_LESSON_RULE).toContain("lesson ids");
	});
});

describe("crystallize in a session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		delete process.env.TREK_PROMOTION_MODEL;
	});

	async function harness(): Promise<Harness> {
		const created = await createHarness({ enableLessons: true });
		harnesses.push(created);
		project(created);
		return created;
	}

	async function storeLesson(created: Harness): Promise<string> {
		const calls: string[] = [];
		created.setResponses(
			Array.from({ length: 3 }, () => (context: Context) => {
				const prompt = firstUserText(context);
				if (context.systemPrompt?.includes("Trek learning step") && prompt.startsWith("Write one lesson")) {
					calls.push("lesson");
					return fauxAssistantMessage(LESSON_JSON);
				}
				calls.push("main");
				const last = context.messages[context.messages.length - 1];
				if (last?.role === "toolResult") return fauxAssistantMessage("config.yaml is not there.");
				return fauxAssistantMessage([fauxToolCall("read", { path: "config.yaml" })], { stopReason: "toolUse" });
			}),
		);
		await created.session.prompt("Read the deploy config.");
		expect(calls).toEqual(["main", "main", "lesson"]);
		return String(customEntries(created, "trek:lesson")[0]?.id);
	}

	function crystallizeTurn(created: Harness, id: string, draft: string, calls: string[]) {
		process.env.TREK_LESSON_PROMOTION = "0";
		created.setResponses(
			Array.from({ length: 4 }, () => (context: Context) => {
				const side = context.systemPrompt?.includes("Trek learning step") ?? false;
				const prompt = firstUserText(context);
				if (side && prompt.startsWith("Decide whether")) {
					calls.push("draft");
					return fauxAssistantMessage(draft);
				}
				calls.push("main");
				const last = context.messages[context.messages.length - 1];
				if (last?.role === "toolResult") return fauxAssistantMessage("done");
				return fauxAssistantMessage([fauxToolCall("crystallize", { lesson_id: id })], { stopReason: "toolUse" });
			}),
		);
	}

	it("a no writes nothing", async () => {
		const created = await harness();
		const id = await storeLesson(created);
		const calls: string[] = [];
		crystallizeTurn(created, id, NO, calls);
		let asked = false;
		created.session.setToolConfirmHandler(() => {
			asked = true;
			return true;
		});
		await created.session.prompt(`Crystallize ${id}.`);
		expect(calls).toEqual(["main", "draft", "main"]);
		expect(asked).toBe(false);
		expect(existsSync(skillPath(created.tempDir, id))).toBe(false);
		expect(customEntries(created, "trek:crystallize")[0]).toMatchObject({ promote: "no", written: false });
	});

	it("a yes without a user Yes writes nothing, including delegated with a grant and print mode", async () => {
		const created = await harness();
		const id = await storeLesson(created);
		const calls: string[] = [];
		crystallizeTurn(created, id, YES, calls);
		created.session.setOperatorMode("delegated");
		created.session.grantTool("crystallize");
		created.session.setToolConfirmHandler(() => false);
		await created.session.prompt(`Crystallize ${id}.`);
		expect(calls).toContain("draft");
		expect(existsSync(skillPath(created.tempDir, id))).toBe(false);
		expect(customEntries(created, "trek:crystallize")[0]).toMatchObject({ promote: "yes", written: false });

		const printed = await harness();
		const printedId = await storeLesson(printed);
		crystallizeTurn(printed, printedId, YES, []);
		await printed.session.prompt(`Crystallize ${printedId}.`);
		expect(existsSync(skillPath(printed.tempDir, printedId))).toBe(false);
	});

	it("a Yes writes the skill and the next session loads it", async () => {
		const created = await harness();
		const id = await storeLesson(created);
		crystallizeTurn(created, id, YES, []);
		let detail = "";
		created.session.setToolConfirmHandler((_tool, text) => {
			detail = text;
			return true;
		});
		await created.session.prompt(`Crystallize ${id}.`);
		expect(detail).toContain("Read deploy/config.yaml");
		expect(existsSync(skillPath(created.tempDir, id))).toBe(true);
		const loaded = loadSkills({
			cwd: created.tempDir,
			agentDir: created.tempDir,
			skillPaths: [],
			includeDefaults: true,
		});
		const loader = createTestResourceLoader();
		loader.getSkills = () => ({ skills: loaded.skills, diagnostics: [] });
		const next = await createHarness({ enableLessons: true, cwd: created.tempDir, resourceLoader: loader });
		harnesses.push(next);
		expect(next.session.systemPrompt).toContain("Read deploy/config.yaml for the deploy settings.");
		expect(buildSystemPrompt({ cwd: created.tempDir, skills: loaded.skills, selectedTools: ["read"] })).toContain(
			"Read deploy/config.yaml",
		);
		expect(await created.session.runLessonCommand("lessons", "")).toContain(id);
		expect(await created.session.runLessonCommand("crystallize", `remove ${id}`)).toBe(`removed ${id}`);
		expect(existsSync(skillPath(created.tempDir, id))).toBe(false);
		const history = join(created.tempDir, ".trek", "skills", "lessons", skillNameForLesson(id), "history");
		expect(readdirSync(history).length).toBe(1);
	});

	it("refuses when no promotion model is assigned", async () => {
		const created = await harness();
		const id = await storeLesson(created);
		const calls: string[] = [];
		crystallizeTurn(created, id, YES, calls);
		process.env.TREK_PROMOTION_MODEL = "0";
		await created.session.prompt(`Crystallize ${id}.`);
		expect(calls).toEqual(["main", "main"]);
		const result = created.session.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "crystallize",
		);
		expect(result && "content" in result ? textOf(result.content) : "").toBe(NO_PROMOTION_MODEL);
		expect(existsSync(skillPath(created.tempDir, id))).toBe(false);
	});

	it("compaction keeps the lesson id in the summary and the trace", async () => {
		const created = await harness();
		const id = await storeLesson(created);
		let seen = "";
		created.setResponses([
			(context: Context) => {
				seen += firstUserText(context);
				return fauxAssistantMessage("## Goal\nRead the deploy config.");
			},
			(context: Context) => {
				seen += firstUserText(context);
				return fauxAssistantMessage("## Goal\nRead the deploy config.");
			},
		]);
		await created.session.compact();
		expect(seen).toContain(COMPACTION_LESSON_RULE);
		const compaction = created.sessionManager.getEntries().find((entry) => entry.type === "compaction");
		expect(compaction && "summary" in compaction ? compaction.summary : "").toContain(`- ${id}`);
		expect(customEntries(created, "trek:compaction")[0]).toMatchObject({ lessonIds: [id] });
	});
});
