/**
 * 0.6.0 ROADMAP — trek trace list|show|diff
 * Run: npx vitest run test/trace-cli.test.ts --reporter=verbose
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
	appendReflectiveCycleTrace,
	buildTraceCycleV1,
	COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE,
	CYCLE_CHECKPOINT_CUSTOM_TYPE,
	getLatestCycleCheckpoint,
	getReflectiveCycleTraces,
	persistCycleBoundary,
} from "../src/core/trace/index.ts";
import { handleTraceCommand } from "../src/trace-cli.ts";

const phases = {
	observe: { phase: "observe" as const, summary: "Observed README" },
	intend: { phase: "intend" as const, summary: "Plan to read README" },
	act: { phase: "act" as const, summary: "Read README.md" },
	reflect: { phase: "reflect" as const, summary: "Read succeeded" },
};

function persistAssistant(manager: SessionManager): void {
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	});
}

function captureStdio(): { logs: string[]; errors: string[]; restore: () => void } {
	const logs: string[] = [];
	const errors: string[] = [];
	const log = console.log;
	const err = console.error;
	console.log = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	};
	return {
		logs,
		errors,
		restore: () => {
			console.log = log;
			console.error = err;
		},
	};
}

describe("trek trace CLI", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		process.exitCode = 0;
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("list, show, and diff a persisted cycle", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-trace-cli-"));
		tempDirs.push(cwd);
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir);
		const manager = SessionManager.create(cwd, sessionDir);
		persistAssistant(manager);
		appendReflectiveCycleTrace(
			manager,
			buildTraceCycleV1({
				cycleNumber: 1,
				promptId: "#1",
				startedAt: "2026-08-26T12:00:00.000Z",
				endedAt: "2026-08-26T12:00:01.000Z",
				phaseTimestamps: {},
				depth: 0,
				taskPreview: "read README",
				phases,
				components: [],
				toolNames: ["read"],
				lawsPre: { allowed: true },
			}),
		);
		const sessionPath = manager.getSessionFile();
		expect(sessionPath).toBeDefined();

		const prev = process.cwd();
		process.chdir(cwd);
		try {
			const listed = captureStdio();
			try {
				const ok = await handleTraceCommand(["trace", "list", "--session-dir", sessionDir]);
				expect(ok).toBe(true);
				expect(listed.logs.join("\n")).toContain("cycles=1");
				expect(listed.logs.join("\n")).toContain("c-0001");
			} finally {
				listed.restore();
			}

			const shown = captureStdio();
			try {
				const ok = await handleTraceCommand(["trace", "show", "c-0001", "--session", sessionPath!]);
				expect(ok).toBe(true);
				expect(shown.logs.join("\n")).toContain("intend:  Plan to read README");
				expect(shown.logs.join("\n")).toContain("act:     Read README.md");
				expect(shown.logs.join("\n")).toContain("laws:    pre=allowed");
			} finally {
				shown.restore();
			}

			const diffed = captureStdio();
			try {
				const ok = await handleTraceCommand(["trace", "diff", "c-0001", "--session", sessionPath!]);
				expect(ok).toBe(true);
				expect(diffed.logs.join("\n")).toContain("status=diverged");
				expect(diffed.logs.join("\n")).toContain("intention: Plan to read README");
				expect(diffed.logs.join("\n")).toContain("outcome:   Read README.md");
				expect(diffed.logs.join("\n")).toContain("tools:     read");
			} finally {
				diffed.restore();
			}
		} finally {
			process.chdir(prev);
		}
	});

	it("forks a branched JSONL at c-0001 without duplicating later prompt ids", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-trace-fork-"));
		tempDirs.push(cwd);
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir);
		const manager = SessionManager.create(cwd, sessionDir);
		persistAssistant(manager);
		manager.appendPromptMeta(1, "#1", "first");
		persistCycleBoundary(
			manager,
			buildTraceCycleV1({
				cycleNumber: 1,
				promptId: "#1",
				startedAt: "2026-08-26T12:00:00.000Z",
				endedAt: "2026-08-26T12:00:01.000Z",
				phaseTimestamps: {},
				depth: 0,
				taskPreview: "first",
				phases,
				components: [],
			}),
		);
		manager.appendPromptMeta(2, "#2", "second");
		persistCycleBoundary(
			manager,
			buildTraceCycleV1({
				cycleNumber: 2,
				promptId: "#2",
				startedAt: "2026-08-26T12:00:02.000Z",
				endedAt: "2026-08-26T12:00:03.000Z",
				phaseTimestamps: {},
				depth: 0,
				taskPreview: "second",
				phases,
				components: [],
			}),
		);
		const sourcePath = manager.getSessionFile()!;
		expect(getLatestCycleCheckpoint(manager.getEntries())?.cycleId).toBe("c-0002");

		const forked = captureStdio();
		try {
			const ok = await handleTraceCommand(["trace", "fork", "c-0001", "--session", sourcePath]);
			expect(ok).toBe(true);
			expect(forked.logs.join("\n")).toContain("forked c-0001 ->");
			expect(forked.logs.join("\n")).toContain("nextPrompt: #2");
		} finally {
			forked.restore();
		}

		const forkLine = forked.logs.find((line) => line.startsWith("forked c-0001 ->"));
		const forkPath = forkLine?.split(" -> ")[1]?.trim();
		expect(forkPath).toBeTruthy();
		const child = SessionManager.open(forkPath!);
		expect(getReflectiveCycleTraces(child.getEntries()).map((t) => t.cycleId)).toEqual(["c-0001"]);
		expect(child.getNextPromptNumber()).toBe(2);
		expect(child.getHeader()?.parentSession).toBe(sourcePath);
		expect(getLatestCycleCheckpoint(child.getEntries())?.cycleId).toBe("c-0001");
		expect(child.getEntries().some((e) => e.type === "custom" && e.customType === CYCLE_CHECKPOINT_CUSTOM_TYPE)).toBe(
			true,
		);
	});

	it("replays a cycle with a patched observe payload", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-trace-replay-"));
		tempDirs.push(cwd);
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir);
		const manager = SessionManager.create(cwd, sessionDir);
		persistAssistant(manager);
		persistCycleBoundary(
			manager,
			buildTraceCycleV1({
				cycleNumber: 1,
				promptId: "#1",
				startedAt: "2026-08-26T12:00:00.000Z",
				endedAt: "2026-08-26T12:00:01.000Z",
				phaseTimestamps: {},
				depth: 0,
				taskPreview: "first",
				phases,
				components: [],
			}),
		);
		const sourcePath = manager.getSessionFile()!;
		const replayed = captureStdio();
		try {
			const ok = await handleTraceCommand([
				"trace",
				"replay",
				"c-0001",
				"--observe",
				"patched observation",
				"--session",
				sourcePath,
			]);
			expect(ok).toBe(true);
			expect(replayed.logs.join("\n")).toContain("replay c-0001 ->");
			expect(replayed.logs.join("\n")).toContain("observe: patched observation");
		} finally {
			replayed.restore();
		}
		const replayLine = replayed.logs.find((line) => line.startsWith("replay c-0001 ->"));
		const replayPath = replayLine?.split(" -> ")[1]?.trim();
		expect(replayPath).toBeTruthy();
		const child = SessionManager.open(replayPath!);
		const injected = child
			.getEntries()
			.find((e) => e.type === "custom" && e.customType === COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE);
		expect(injected).toBeDefined();
		expect((injected as { data?: { observe?: string } }).data?.observe).toBe("patched observation");
	});

	it("returns false for non-trace commands", async () => {
		expect(await handleTraceCommand(["history"])).toBe(false);
	});
});
