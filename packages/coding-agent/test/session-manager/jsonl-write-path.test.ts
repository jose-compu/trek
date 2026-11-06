/**
 * 0.17 #111: session JSONL append path.
 * Run: npx vitest --run test/session-manager/jsonl-write-path.test.ts --reporter=verbose
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import {
	buildTraceCycleV1,
	CYCLE_CHECKPOINT_CUSTOM_TYPE,
	persistCycleBoundary,
	REFLECTIVE_CYCLE_CUSTOM_TYPE,
} from "../../src/core/trace/index.ts";
import { assertUnderBudget } from "../performance-budgets.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

function parseLines(path: string): Record<string, unknown>[] {
	return readFileSync(path, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("SessionManager JSONL write path", () => {
	const dirs: string[] = [];
	afterEach(() => {
		while (dirs.length > 0) {
			const dir = dirs.pop();
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	function persisted(): SessionManager {
		const dir = join(tmpdir(), `trek-jsonl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		dirs.push(dir);
		return SessionManager.create(dir, dir);
	}

	it("defers the file until the first assistant message", () => {
		const session = persisted();
		session.appendMessage(userMsg("hello"));
		session.appendCustomEntry("note", { n: 1 });
		const file = session.getSessionFile();
		expect(file).toBeTruthy();
		expect(existsSync(file!)).toBe(false);

		session.appendMessage(assistantMsg("ok"));
		expect(existsSync(file!)).toBe(true);
		const records = parseLines(file!);
		expect(records[0]?.type).toBe("session");
		expect(records.filter((row) => row.type === "session")).toHaveLength(1);
		expect(records.some((row) => row.type === "custom" && row.customType === "note")).toBe(true);
		session.dispose();
	});

	it("appends many custom entries without rewriting the header", () => {
		const session = persisted();
		session.appendMessage(userMsg("q"));
		session.appendMessage(assistantMsg("a"));
		const file = session.getSessionFile()!;
		const afterAssistant = parseLines(file).length;

		const ids = session.appendCustomEntries(
			Array.from({ length: 50 }, (_, i) => ({ customType: "burst", data: { i } })),
		);
		expect(ids).toHaveLength(50);
		const records = parseLines(file);
		expect(records[0]?.type).toBe("session");
		expect(records.filter((row) => row.type === "session")).toHaveLength(1);
		expect(records.filter((row) => row.customType === "burst")).toHaveLength(50);
		expect(records.length).toBe(afterAssistant + 50);
		session.dispose();
	});

	it("writes cycle trace and checkpoint in one persist so trek trace can read the file", () => {
		const session = persisted();
		session.appendMessage(userMsg("read README"));
		session.appendMessage(assistantMsg("done"));
		persistCycleBoundary(
			session,
			buildTraceCycleV1({
				cycleNumber: 1,
				promptId: "p1",
				startedAt: "2026-01-01T00:00:00.000Z",
				endedAt: "2026-01-01T00:00:01.000Z",
				phaseTimestamps: {},
				depth: 0,
				taskPreview: "read README",
				phases: {
					observe: { phase: "observe", summary: "saw README" },
					intend: { phase: "intend", summary: "read it" },
					act: { phase: "act", summary: "read README.md" },
					reflect: { phase: "reflect", summary: "ok" },
				},
				components: [],
				toolNames: ["read"],
				lawsPre: { allowed: true },
			}),
		);
		const file = session.getSessionFile()!;
		const records = parseLines(file);
		const types = records.filter((row) => row.type === "custom").map((row) => row.customType);
		expect(types).toEqual([REFLECTIVE_CYCLE_CUSTOM_TYPE, CYCLE_CHECKPOINT_CUSTOM_TYPE]);

		const reopened = SessionManager.open(file);
		const custom = reopened.getEntries().filter((entry) => entry.type === "custom");
		expect(custom).toHaveLength(2);
		expect(custom[0]).toMatchObject({ customType: REFLECTIVE_CYCLE_CUSTOM_TYPE });
		expect(custom[1]).toMatchObject({ customType: CYCLE_CHECKPOINT_CUSTOM_TYPE });
		session.dispose();
		reopened.dispose();
	});

	it("records JSONL append wall clock for a burst after first assistant", () => {
		const session = persisted();
		session.appendMessage(userMsg("q"));
		session.appendMessage(assistantMsg("a"));
		const started = performance.now();
		for (let i = 0; i < 400; i++) {
			session.appendCustomEntry("bench", { i });
		}
		const jsonlAppendMs = Number((performance.now() - started).toFixed(1));
		expect(jsonlAppendMs).toBeGreaterThanOrEqual(0);
		assertUnderBudget("jsonl_append_400_ms", jsonlAppendMs);
		const file = session.getSessionFile()!;
		expect(parseLines(file).filter((row) => row.customType === "bench")).toHaveLength(400);
		process.stdout.write(`METRIC jsonl_append_400_ms=${jsonlAppendMs}\n`);
		session.dispose();
	});
});
