import { describe, expect, test } from "vitest";
import { REFLECTIVE_CYCLE_CUSTOM_TYPE } from "../src/core/reflective-loop/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import {
	appendReflectiveCycleTrace,
	buildTraceCycleV1,
	createCycleId,
	diffIntentionOutcome,
	findCycleTrace,
	normalizeLawsVerdict,
	parseCycleTrace,
	parseCycleTraceFromEntry,
	TRACE_SCHEMA_VERSION,
} from "../src/core/trace/index.ts";

const phases = {
	observe: { phase: "observe" as const, summary: "Observed" },
	intend: { phase: "intend" as const, summary: "Intend" },
	act: { phase: "act" as const, summary: "Act" },
	reflect: { phase: "reflect" as const, summary: "Reflect" },
};

describe("trace schema v1", () => {
	test("createCycleId is zero-padded", () => {
		expect(createCycleId(1)).toBe("c-0001");
		expect(createCycleId(42)).toBe("c-0042");
	});

	test("buildTraceCycleV1 sets schemaVersion, cycleId, tools, laws pre/post", () => {
		const trace = buildTraceCycleV1({
			cycleNumber: 3,
			promptId: "#2",
			startedAt: "2026-08-26T12:00:00.000Z",
			endedAt: "2026-08-26T12:00:01.000Z",
			phaseTimestamps: {
				observe: { startedAt: "2026-08-26T12:00:00.000Z", endedAt: "2026-08-26T12:00:00.100Z" },
			},
			depth: 0,
			taskPreview: "read README",
			phases,
			components: [],
			toolNames: ["read"],
			lawsPre: { allowed: true },
			lawsPost: { allowed: false, law: 0, reason: "harmful output" },
		});

		expect(trace.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
		expect(trace.cycleId).toBe("c-0003");
		expect(trace.toolNames).toEqual(["read"]);
		expect(trace.lawsVerdict.pre?.allowed).toBe(true);
		expect(trace.lawsVerdict.post?.law).toBe(0);
	});

	test("parseCycleTrace upgrades legacy flat lawsVerdict", () => {
		const parsed = parseCycleTrace({
			cycleNumber: 1,
			promptId: "#1",
			depth: 0,
			taskPreview: "legacy",
			phases,
			components: [],
			lawsVerdict: { allowed: false, law: 1, reason: "blocked" },
		});

		expect(parsed?.schemaVersion).toBe(1);
		expect(parsed?.cycleId).toBe("c-0001");
		expect(parsed?.toolNames).toEqual([]);
		expect(parsed?.lawsVerdict.pre?.allowed).toBe(false);
		expect(parsed?.lawsVerdict.pre?.law).toBe(1);
		expect(parsed?.lawsVerdict.post).toBeUndefined();
	});

	test("parseCycleTrace rejects payloads without phases", () => {
		expect(parseCycleTrace({ cycleNumber: 1 })).toBeUndefined();
		expect(parseCycleTrace(null)).toBeUndefined();
	});

	test("normalizeLawsVerdict accepts pair and flat shapes", () => {
		expect(normalizeLawsVerdict({ pre: { allowed: true } }).pre?.allowed).toBe(true);
		expect(normalizeLawsVerdict({ allowed: false, law: 0 }).pre?.law).toBe(0);
		expect(normalizeLawsVerdict(undefined)).toEqual({});
	});

	test("append + parse from session entry uses entry timestamp fallback", () => {
		const manager = SessionManager.inMemory(process.cwd());
		const built = buildTraceCycleV1({
			cycleNumber: 1,
			startedAt: "2026-08-26T12:00:00.000Z",
			endedAt: "2026-08-26T12:00:01.000Z",
			phaseTimestamps: {},
			depth: 0,
			taskPreview: "ok",
			phases,
			components: [],
			lawsPre: { allowed: true },
		});
		appendReflectiveCycleTrace(manager, built);

		const entry = manager
			.getEntries()
			.find((e) => e.type === "custom" && e.customType === REFLECTIVE_CYCLE_CUSTOM_TYPE);
		expect(entry).toBeDefined();
		const parsed = parseCycleTraceFromEntry(entry!);
		expect(parsed?.schemaVersion).toBe(1);
		expect(parsed?.cycleId).toBe("c-0001");
		expect(parsed?.lawsVerdict.pre?.allowed).toBe(true);
	});

	test("findCycleTrace matches cycleId, cycle number, and prompt id", () => {
		const manager = SessionManager.inMemory(process.cwd());
		appendReflectiveCycleTrace(
			manager,
			buildTraceCycleV1({
				cycleNumber: 2,
				promptId: "#2",
				startedAt: "2026-08-26T12:00:00.000Z",
				endedAt: "2026-08-26T12:00:01.000Z",
				phaseTimestamps: {},
				depth: 0,
				taskPreview: "ok",
				phases,
				components: [],
			}),
		);
		const entries = manager.getEntries();
		expect(findCycleTrace(entries, "c-0002")?.trace.cycleId).toBe("c-0002");
		expect(findCycleTrace(entries, "2")?.trace.promptId).toBe("#2");
		expect(findCycleTrace(entries, "#2")?.trace.cycleNumber).toBe(2);
		expect(findCycleTrace(entries, "missing")).toBeUndefined();
	});

	test("diffIntentionOutcome reports matched, diverged, blocked, skipped", () => {
		const base = {
			cycleNumber: 1,
			startedAt: "2026-08-26T12:00:00.000Z",
			endedAt: "2026-08-26T12:00:01.000Z",
			phaseTimestamps: {},
			depth: 0,
			taskPreview: "ok",
			components: [] as [],
		};
		const matched = buildTraceCycleV1({
			...base,
			phases: {
				...phases,
				intend: { phase: "intend", summary: "same" },
				act: { phase: "act", summary: "same" },
			},
		});
		expect(diffIntentionOutcome(matched).status).toBe("matched");

		const diverged = buildTraceCycleV1({
			...base,
			phases: {
				...phases,
				intend: { phase: "intend", summary: "plan" },
				act: { phase: "act", summary: "did something else" },
			},
			toolNames: ["edit"],
		});
		expect(diffIntentionOutcome(diverged)).toMatchObject({
			status: "diverged",
			intend: "plan",
			act: "did something else",
			tools: ["edit"],
		});

		const blocked = buildTraceCycleV1({
			...base,
			phases: {
				...phases,
				intend: { phase: "intend", summary: "plan", blocked: true },
			},
		});
		expect(diffIntentionOutcome(blocked).status).toBe("blocked");

		const skipped = buildTraceCycleV1({
			...base,
			phases: {
				...phases,
				act: { phase: "act", summary: "n/a", skipped: true },
			},
		});
		expect(diffIntentionOutcome(skipped).status).toBe("skipped");
	});
});
