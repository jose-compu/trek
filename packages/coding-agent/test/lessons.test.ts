/**
 * 0.14.0 lessons: the work-horse writes L3, the Planning/Frontier model promotes to L2.
 * Run: npx vitest run test/lessons.test.ts --reporter=verbose
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@trek/ai";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { shouldLoadMemoryOnnx } from "../src/core/memory/embedder.ts";
import { recurLessonAcross, saveLessonRecordAt } from "../src/core/reflective-loop/crystallize.ts";
import {
	classifyLessonLayer,
	formatLesson,
	isCorrection,
	lessonFromHostCliFailure,
	parseLesson,
	parsePromotion,
	turnFailures,
} from "../src/core/reflective-loop/lesson.ts";
import type { AuditStepRecord } from "../src/core/reproducibility/types.ts";
import { promotionRole } from "../src/core/runtime/promotion-model.ts";
import type { ResolvedRuntime } from "../src/core/runtime/resolve.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
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
		layering: "single",
		suite: "mistral",
		quant: "Q4_K_M",
		rerank: true,
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
		const frontier = { source: "api" as const, id: "grok", provider: "xai", thinking: "deep" as const };
		const planning = { source: "local" as const, id: "Ministral-3-14B", thinking: "deep" as const };
		const workhorse = { source: "local" as const, id: "Ministral-3-3B", thinking: "off" as const };
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

	it("a failed gh milestone stores the canned global lesson without a side call", async () => {
		const home = mkdtempSync(join(tmpdir(), "trek-home-gh-"));
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		try {
			const harness = await createHarness({
				enableLessons: true,
				settings: { memory: { global: true } },
				tools: [
					{
						name: "bash",
						label: "bash",
						description: "run a shell command",
						parameters: { type: "object", properties: { command: { type: "string" } } },
						async execute() {
							throw new Error(
								'unknown command "milestone" for "gh"\n\nUsage:  gh <command> <subcommand> [flags]\n\nCommand exited with code 1',
							);
						},
					} as never,
				],
				initialActiveToolNames: ["bash"],
			});
			harnesses.push(harness);
			project(harness);
			const calls: string[] = [];
			harness.setResponses(
				script(
					2,
					{
						main: (context) => {
							const last = context.messages[context.messages.length - 1];
							if (last?.role === "toolResult") {
								return fauxAssistantMessage("Use gh api. Milestone v1.0.0.");
							}
							return fauxAssistantMessage([fauxToolCall("bash", { command: "gh milestone list" })], {
								stopReason: "toolUse",
							});
						},
					},
					calls,
				),
			);
			await harness.session.prompt("Run gh milestone and list the milestones for this repo.");
			expect(calls).toEqual(["main", "main"]);
			expect(customEntries(harness, "trek:lesson_dropped")).toEqual([]);
			const [entry] = customEntries(harness, "trek:lesson");
			expect(entry).toMatchObject({
				kind: "error",
				layer: "global",
				lesson: {
					recurrence_key: "engineering|cli|gh|milestone",
					rule: "Use `gh api repos/{owner}/{repo}/milestones` to list or POST a milestone. Do not run `gh milestone`.",
				},
			});
			const notices = harness.eventsOfType("lesson_stored").map((event) => event.text);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatch(new RegExp(`^lesson ${String(entry?.id).replace(":", "\\:")} `));
			expect(notices[0]).toMatch(/Gh Api|Milestone/i);
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("a later prompt recalls the gh milestone lesson through the promotion model", async () => {
		const home = mkdtempSync(join(tmpdir(), "trek-home-gh-recall-"));
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		try {
			const first = await createHarness({
				enableLessons: true,
				settings: { memory: { global: true } },
				tools: [
					{
						name: "bash",
						label: "bash",
						description: "run a shell command",
						parameters: { type: "object", properties: { command: { type: "string" } } },
						async execute() {
							throw new Error('unknown command "milestone" for "gh"\nCommand exited with code 1');
						},
					} as never,
				],
				initialActiveToolNames: ["bash"],
			});
			harnesses.push(first);
			project(first);
			first.setResponses(
				script(
					2,
					{
						main: (context) => {
							const last = context.messages[context.messages.length - 1];
							if (last?.role === "toolResult") return fauxAssistantMessage("listed via api");
							return fauxAssistantMessage([fauxToolCall("bash", { command: "gh milestone list" })], {
								stopReason: "toolUse",
							});
						},
					},
					[],
				),
			);
			await first.session.prompt("Run gh milestone and list the milestones for this repo.");
			const id = String(customEntries(first, "trek:lesson")[0]?.id);
			expect(id).toMatch(/^global:\d+$/);

			const second = await createHarness({
				enableLessons: true,
				cwd: first.tempDir,
				settings: { memory: { global: true } },
			});
			harnesses.push(second);
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
						main: () => fauxAssistantMessage("Using gh api for milestones."),
					},
					calls,
				),
			);
			await second.session.prompt("List the GitHub milestones again.");
			expect(calls).toEqual(["promote", "main"]);
			expect(promptSeen).toContain(id);
			expect(customEntries(second, "trek:lesson_promotion")[0]).toMatchObject({ picked: [id] });
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			rmSync(home, { recursive: true, force: true });
		}
	});

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
			`lesson ${customEntries(harness, "trek:lesson")[0]?.id} Deploy To Staging First`,
		]);
	});
});

describe("lesson layers", () => {
	it("defaults session, project, and global memory on with MiniLM preferred in api and local", () => {
		expect(SettingsManager.inMemory({}).getMemorySettings()).toMatchObject({
			enabled: true,
			session: true,
			project: true,
			global: true,
		});
		expect(shouldLoadMemoryOnnx({}, "api")).toBe(true);
		expect(shouldLoadMemoryOnnx({}, "local")).toBe(true);
		expect(shouldLoadMemoryOnnx({}, "hybrid")).toBe(true);
	});

	it("routes gh milestone to a global canned lesson and does not duplicate across stores", () => {
		const lesson = lessonFromHostCliFailure([
			'bash: unknown command "milestone" for "gh"\nRun \'gh --help\' for usage.',
		]);
		expect(lesson?.rule).toMatch(/gh api repos\/\{owner\}\/\{repo\}\/milestones/);
		expect(classifyLessonLayer(lesson!, { kind: "error", task: "make a milestone", failures: [], reply: "" })).toBe(
			"global",
		);
		expect(
			classifyLessonLayer(
				{
					trigger: "deploy",
					mistake: "read config.yaml at the root",
					rule: "Read deploy/config.yaml.",
					domain: "engineering",
				},
				{ kind: "error", task: "deploy", failures: ["read: missing"], reply: "" },
			),
		).toBe("project");

		const root = mkdtempSync(join(tmpdir(), "trek-lesson-layers-"));
		const stores = {
			global: join(root, "global"),
			project: join(root, "project"),
			session: join(root, "session"),
		};
		saveLessonRecordAt(stores.global, "global:1", lesson!);
		const again = recurLessonAcross(stores, lesson!, "project");
		expect(again?.id).toBe("global:1");
		expect(again?.count).toBe(2);
		expect(recurLessonAcross(stores, { ...lesson!, recurrence_key: "other" }, "project")).toBeUndefined();
		rmSync(root, { recursive: true, force: true });
	});
});
