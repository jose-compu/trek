/**
 * 0.14.0 lessons: the work-horse writes L3, the Planning/Frontier model promotes to L2.
 * Run: npx vitest run test/lessons.test.ts --reporter=verbose
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@trek/ai";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	formatLesson,
	isCorrection,
	parseLesson,
	parsePromotion,
	turnFailures,
} from "../src/core/reflective-loop/lesson.ts";
import type { AuditStepRecord } from "../src/core/reproducibility/types.ts";
import { promotionRole } from "../src/core/runtime/promotion-model.ts";
import type { ResolvedRuntime } from "../src/core/runtime/resolve.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

type Reply = ReturnType<typeof fauxAssistantMessage>;

const LESSON_JSON = JSON.stringify({
	trigger: "reading the deploy config",
	mistake: "read config.yaml at the root, which does not exist",
	rule: "Read deploy/config.yaml for the deploy settings.",
	domain: "deploy",
});

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

interface Handlers {
	lesson?: (context: Context) => Reply;
	promote?: (context: Context) => Reply;
	main: (context: Context) => Reply;
}

/** Side calls and turn calls are told apart by their prompt, so queue order does not matter. */
function script(count: number, handlers: Handlers, calls: string[]) {
	return Array.from({ length: count }, () => (context: Context) => {
		const side = context.systemPrompt?.includes("Trek learning step") ?? false;
		const prompt = firstUserText(context);
		if (side && prompt.startsWith("Write one lesson")) {
			calls.push("lesson");
			return handlers.lesson ? handlers.lesson(context) : fauxAssistantMessage("{}");
		}
		if (side && prompt.startsWith("Choose the stored lessons")) {
			calls.push("promote");
			return handlers.promote ? handlers.promote(context) : fauxAssistantMessage('{"ids": []}');
		}
		calls.push("main");
		return handlers.main(context);
	});
}

function missingRead(): Handlers["main"] {
	return (context) => {
		const last = context.messages[context.messages.length - 1];
		if (last?.role === "toolResult") return fauxAssistantMessage("config.yaml is not there.");
		return fauxAssistantMessage([fauxToolCall("read", { path: "config.yaml" })], { stopReason: "toolUse" });
	};
}

function customEntries(harness: Harness, type: string): Array<Record<string, unknown>> {
	return harness.sessionManager
		.getEntries()
		.flatMap((entry) =>
			entry.type === "custom" && entry.customType === type ? [entry.data as Record<string, unknown>] : [],
		);
}

function project(harness: Harness): void {
	mkdirSync(join(harness.tempDir, ".git"), { recursive: true });
	writeFileSync(join(harness.tempDir, "package.json"), "{}\n");
}

function resolved(roles: ResolvedRuntime["roles"]): ResolvedRuntime {
	return {
		mode: "api",
		effectiveMode: "api",
		suite: "mistral",
		quant: "Q4_K_M",
		rerank: false,
		presetRoles: roles,
		roles,
		requiresHuggingFaceToken: false,
		frontierAvailable: Boolean(roles.frontier),
	};
}

describe("lesson helpers", () => {
	it("recognizes a correction", () => {
		for (const text of ["no, use staging", "That is wrong.", "that's not what I asked", "wrong file", "/undo"]) {
			expect(isCorrection(text), text).toBe(true);
		}
		for (const text of ["now read the file", "nothing else", "Please continue", "known issue"]) {
			expect(isCorrection(text), text).toBe(false);
		}
	});

	it("collects tool errors and effort stops, and nothing from a clean turn", () => {
		expect(
			turnFailures([
				{ role: "user", content: "x" },
				{
					role: "toolResult",
					toolName: "read",
					isError: true,
					content: [{ type: "text", text: "ENOENT config.yaml" }],
				},
				{
					role: "toolResult",
					toolName: "bash",
					isError: false,
					content: [{ type: "text", text: "ok\nEffortRegulator stopped: repeated action." }],
				},
			]),
		).toEqual(["read: ENOENT config.yaml", "bash: EffortRegulator stopped: repeated action."]);
		expect(turnFailures([{ role: "toolResult", toolName: "read", isError: false, content: "fine" }])).toEqual([]);
	});

	it("parses a lesson with a preamble and rejects one without a rule", () => {
		const lesson = parseLesson(`Here it is:\n\`\`\`json\n${LESSON_JSON}\n\`\`\``);
		expect(lesson).toEqual({
			trigger: "reading the deploy config",
			mistake: "read config.yaml at the root, which does not exist",
			rule: "Read deploy/config.yaml for the deploy settings.",
			domain: "deploy",
		});
		expect(formatLesson(lesson!)).toBe(
			"Rule: Read deploy/config.yaml for the deploy settings.\nWhen: reading the deploy config\nMistake: read config.yaml at the root, which does not exist",
		);
		expect(parseLesson('{"trigger": "x", "rule": ""}')).toBeUndefined();
		expect(parseLesson("no json")).toBeUndefined();
		expect(parseLesson('{"rule": "Do it.", "domain": "Two Words"}')?.domain).toBe("general");
	});

	it("keeps only listed ids, once each, at most five", () => {
		const ids = ["project:1", "project:2", "project:3", "project:4", "project:5", "project:6"];
		expect(parsePromotion('{"ids": ["project:2", "project:99", "project:2", "project:1"]}', ids)).toEqual([
			"project:2",
			"project:1",
		]);
		expect(parsePromotion(JSON.stringify({ ids }), ids)).toHaveLength(5);
		expect(parsePromotion('{"ids": []}', ids)).toEqual([]);
		expect(parsePromotion("none apply", ids)).toBeUndefined();
		expect(parsePromotion('{"ids": "project:1"}', ids)).toBeUndefined();
	});

	it("promotes with Frontier, else Planning, else nothing", () => {
		const frontier = { source: "api" as const, id: "grok", provider: "xai", thinking: true };
		const planning = { source: "local" as const, id: "Ministral-3-14B", thinking: true };
		const workhorse = { source: "local" as const, id: "Ministral-3-3B", thinking: false };
		expect(promotionRole(resolved({ frontier, planning, workhorse }))?.role).toBe("frontier");
		expect(promotionRole(resolved({ planning, workhorse }))).toMatchObject({
			role: "planning",
			reason: "Frontier is not assigned; promotion uses Planning",
		});
		expect(promotionRole(resolved({ workhorse }))).toBeUndefined();
	});
});

describe("lessons in a session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function lessonHarness(cwd?: string): Promise<Harness> {
		const harness = await createHarness({ enableLessons: true, ...(cwd ? { cwd } : {}) });
		harnesses.push(harness);
		if (!cwd) project(harness);
		return harness;
	}

	async function storeLesson(): Promise<{ harness: Harness; id: string }> {
		const harness = await lessonHarness();
		const calls: string[] = [];
		harness.setResponses(script(3, { lesson: () => fauxAssistantMessage(LESSON_JSON), main: missingRead() }, calls));
		await harness.session.prompt("Read the deploy config.");
		expect(calls).toEqual(["main", "main", "lesson"]);
		const [entry] = customEntries(harness, "trek:lesson");
		expect(entry).toMatchObject({
			kind: "error",
			lesson: { rule: "Read deploy/config.yaml for the deploy settings." },
		});
		return { harness, id: String(entry?.id) };
	}

	it("a failed task stores a lesson that a new session recalls through the promotion model", async () => {
		const { harness: first, id } = await storeLesson();
		expect(id).toMatch(/^project:\d+$/);

		const second = await lessonHarness(first.tempDir);
		const calls: string[] = [];
		let promptSeen = "";
		second.setResponses(
			script(
				2,
				{
					promote: (context) => {
						promptSeen = firstUserText(context);
						return fauxAssistantMessage(JSON.stringify({ ids: [id] }));
					},
					main: () => fauxAssistantMessage("Reading deploy/config.yaml."),
				},
				calls,
			),
		);
		await second.session.prompt("Where are the deploy config settings?");

		expect(calls).toEqual(["promote", "main"]);
		expect(promptSeen).toContain(`${id}: Rule: Read deploy/config.yaml`);
		expect(second.session.systemPrompt).toContain("Read deploy/config.yaml for the deploy settings.");
		const [promotion] = customEntries(second, "trek:lesson_promotion");
		expect(promotion).toMatchObject({ layer: "L2", candidates: [id], picked: [id] });
		expect(["frontier", "planning"]).toContain(promotion?.role);
		const steps = second.sessionManager.getAuditSteps<AuditStepRecord>();
		expect(steps.some((step) => step.retrievedLessonIds.includes(id))).toBe(true);
	});

	it("drops an invented id and leaves the lesson out", async () => {
		const { harness: first, id } = await storeLesson();
		const second = await lessonHarness(first.tempDir);
		const calls: string[] = [];
		second.setResponses(
			script(
				2,
				{
					promote: () => fauxAssistantMessage('{"ids": ["project:999"]}'),
					main: () => fauxAssistantMessage("ok"),
				},
				calls,
			),
		);
		await second.session.prompt("Where are the deploy config settings?");

		expect(calls).toEqual(["promote", "main"]);
		expect(second.session.systemPrompt).not.toContain("deploy/config.yaml");
		expect(customEntries(second, "trek:lesson_promotion")[0]).toMatchObject({ candidates: [id], picked: [] });
	});

	it("an unusable promotion reply keeps score order", async () => {
		const { harness: first } = await storeLesson();
		const second = await lessonHarness(first.tempDir);
		const calls: string[] = [];
		second.setResponses(
			script(
				2,
				{ promote: () => fauxAssistantMessage("I think the first one."), main: () => fauxAssistantMessage("ok") },
				calls,
			),
		);
		await second.session.prompt("Where are the deploy config settings?");

		expect(calls).toEqual(["promote", "main"]);
		expect(second.session.systemPrompt).toContain("Read deploy/config.yaml for the deploy settings.");
		expect(customEntries(second, "trek:lesson_promotion")[0]).toMatchObject({ picked: null });
	});

	it("TREK_LESSON_PROMOTION=0 uses score order and makes no promotion call", async () => {
		const { harness: first } = await storeLesson();
		const second = await lessonHarness(first.tempDir);
		process.env.TREK_LESSON_PROMOTION = "0";
		const calls: string[] = [];
		second.setResponses(script(1, { main: () => fauxAssistantMessage("ok") }, calls));
		await second.session.prompt("Where are the deploy config settings?");

		expect(calls).toEqual(["main"]);
		expect(second.session.systemPrompt).toContain("Read deploy/config.yaml for the deploy settings.");
		expect(customEntries(second, "trek:lesson_promotion")).toEqual([]);
	});

	it("no stored lesson means no promotion call, and a clean turn writes no lesson", async () => {
		const harness = await lessonHarness();
		writeFileSync(join(harness.tempDir, "notes.txt"), "hello\n");
		const calls: string[] = [];
		harness.setResponses(
			script(
				2,
				{
					main: (context) => {
						const last = context.messages[context.messages.length - 1];
						if (last?.role === "toolResult") return fauxAssistantMessage("It says hello.");
						return fauxAssistantMessage([fauxToolCall("read", { path: "notes.txt" })], { stopReason: "toolUse" });
					},
				},
				calls,
			),
		);
		await harness.session.prompt("Read notes.txt.");

		expect(calls).toEqual(["main", "main"]);
		expect(customEntries(harness, "trek:lesson")).toEqual([]);
		expect(customEntries(harness, "trek:lesson_promotion")).toEqual([]);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("memory off writes nothing and makes no side call", async () => {
		const harness = await createHarness({ enableLessons: true, settings: { memory: { enabled: false } } });
		harnesses.push(harness);
		project(harness);
		const calls: string[] = [];
		harness.setResponses(script(2, { main: missingRead() }, calls));
		await harness.session.prompt("Read the deploy config.");

		expect(calls).toEqual(["main", "main"]);
		expect(customEntries(harness, "trek:lesson")).toEqual([]);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("a correction writes a lesson about the previous turn before the next answer", async () => {
		const harness = await lessonHarness();
		const calls: string[] = [];
		let lessonPrompt = "";
		harness.setResponses(
			script(
				4,
				{
					lesson: (context) => {
						lessonPrompt = firstUserText(context);
						return fauxAssistantMessage(
							JSON.stringify({
								trigger: "choosing a deploy target",
								mistake: "used production",
								rule: "Deploy to staging first.",
								domain: "deploy",
							}),
						);
					},
					main: () =>
						fauxAssistantMessage(calls.length <= 1 ? "Deploying to production." : "Deploying to staging."),
				},
				calls,
			),
		);
		await harness.session.prompt("Deploy the app.");
		await harness.session.prompt("No, that is wrong. Use staging first.");

		expect(calls).toEqual(["main", "lesson", "promote", "main"]);
		expect(lessonPrompt).toContain("Task: Deploy the app.");
		expect(lessonPrompt).toContain("Reply: Deploying to production.");
		expect(lessonPrompt).toContain("User correction: No, that is wrong. Use staging first.");
		expect(customEntries(harness, "trek:lesson")[0]).toMatchObject({
			kind: "correction",
			lesson: { rule: "Deploy to staging first." },
		});
		expect(harness.eventsOfType("lesson_stored").map((event) => event.text)).toEqual([
			`lesson ${customEntries(harness, "trek:lesson")[0]?.id}`,
		]);
	});
});
