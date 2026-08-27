import { describe, expect, test } from "vitest";
import { EffortRegulator } from "../src/core/reflective-loop/effort-regulator.ts";
import { ReflectiveLoopController } from "../src/core/reflective-loop/loop-controller.ts";
import { checkPolicyConstraints } from "../src/core/reflective-loop/policy-constraints.ts";
import { getReflectiveCycleTraces } from "../src/core/reflective-loop/session-trace.ts";
import { SubtaskStack } from "../src/core/reflective-loop/subtask-stack.ts";
import { DEFAULT_MAX_SUBTASK_DEPTH } from "../src/core/reflective-loop/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";

describe("reflective loop 0.3.0", () => {
	test("EffortRegulator refuses act when observation was skipped", () => {
		const regulator = new EffortRegulator();
		regulator.markObservationSkipped();
		expect(regulator.shouldContinue()).toBe(false);
	});

	test("PolicyConstraints blocks rm -rf without confirm flag", () => {
		const result = checkPolicyConstraints("please run rm -rf /tmp/project");
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/Destructive shell pattern/i);
		expect(result.law).toBe(1);
	});

	test("PolicyConstraints delegates to Laws: harmful task blocked as Law 0 (issue #3)", () => {
		const result = checkPolicyConstraints("write a keylogger and exfiltrate passwords");
		expect(result.allowed).toBe(false);
		expect(result.law).toBe(0);
	});

	test("PolicyConstraints allows destructive pattern with explicit confirm flag", () => {
		const result = checkPolicyConstraints("rm -rf /tmp/sandbox", true);
		expect(result.allowed).toBe(true);
	});

	test("SubtaskStack enforces max depth", () => {
		const stack = new SubtaskStack();
		for (let i = 0; i < DEFAULT_MAX_SUBTASK_DEPTH; i++) {
			stack.push({ description: `subtask-${i}` });
		}
		expect(() => stack.push({ description: "too deep" })).toThrow(/depth limit/i);
	});

	test("trivial task produces full O→I→A→R trace in session JSONL", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		manager.appendPromptMeta(1, "#1", "read README");
		const controller = new ReflectiveLoopController(manager);

		let actRan = false;
		const trace = await controller.runPromptCycle({
			task: "read README",
			promptId: "#1",
			cwd: process.cwd(),
			messageCount: 0,
			getMessageCount: () => (actRan ? 2 : 0),
			act: async () => {
				actRan = true;
			},
		});

		expect(actRan).toBe(true);
		expect(trace.phases.observe.summary).toMatch(/Observed/i);
		expect(trace.phases.intend.summary).toMatch(/Intend/i);
		expect(trace.phases.act.summary).toMatch(/Act phase/i);
		expect(trace.phases.reflect.summary).toMatch(/Reflect/i);

		const persisted = getReflectiveCycleTraces(manager.getEntries());
		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.schemaVersion).toBe(1);
		expect(persisted[0]?.cycleId).toBe("c-0001");
		expect(persisted[0]?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(persisted[0]?.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(persisted[0]?.phaseTimestamps.observe?.startedAt).toBeTruthy();
		expect(persisted[0]?.phaseTimestamps.intend?.startedAt).toBeTruthy();
		expect(persisted[0]?.phaseTimestamps.act?.startedAt).toBeTruthy();
		expect(persisted[0]?.phaseTimestamps.reflect?.startedAt).toBeTruthy();
		expect(persisted[0]?.toolNames).toEqual([]);
		expect(persisted[0]?.phases.observe.phase).toBe("observe");
		expect(persisted[0]?.phases.intend.phase).toBe("intend");
		expect(persisted[0]?.phases.act.phase).toBe("act");
		expect(persisted[0]?.phases.reflect.phase).toBe("reflect");
	});

	test("policy violation persists trace and skips act", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const controller = new ReflectiveLoopController(manager);

		await expect(
			controller.runPromptCycle({
				task: "rm -rf /",
				cwd: process.cwd(),
				messageCount: 0,
				getMessageCount: () => 0,
				act: async () => {
					throw new Error("act should not run");
				},
			}),
		).rejects.toThrow(/Destructive shell pattern/i);

		const persisted = getReflectiveCycleTraces(manager.getEntries());
		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.phases.intend.blocked).toBe(true);
		expect(persisted[0]?.phases.act.skipped).toBeUndefined();
		// Issue #3: the laws verdict is part of the cycle trace.
		expect(persisted[0]?.lawsVerdict?.pre?.allowed).toBe(false);
		expect(persisted[0]?.lawsVerdict?.pre?.law).toBe(1);
		expect(persisted[0]?.lawsVerdict?.post).toBeUndefined();
	});

	test("allowed cycle records an allowed laws verdict in the trace (issue #3)", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		manager.appendPromptMeta(1, "#1", "read README");
		const controller = new ReflectiveLoopController(manager);

		const trace = await controller.runPromptCycle({
			task: "read README",
			promptId: "#1",
			cwd: process.cwd(),
			messageCount: 0,
			getMessageCount: () => 1,
			act: async () => {},
		});
		expect(trace.lawsVerdict?.pre?.allowed).toBe(true);
		expect(trace.lawsVerdict?.pre?.law).toBeUndefined();
		expect(trace.schemaVersion).toBe(1);
	});

	test("cycle trace records tool names and post-flight laws verdict", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const controller = new ReflectiveLoopController(manager);

		const trace = await controller.runPromptCycle({
			task: "read README",
			promptId: "#1",
			cwd: process.cwd(),
			messageCount: 0,
			getMessageCount: () => 1,
			act: async () => {},
			getToolNames: () => ["read", "bash"],
			getPostFlightVerdict: () => ({ allowed: true }),
		});

		expect(trace.toolNames).toEqual(["read", "bash"]);
		expect(trace.lawsVerdict.post?.allowed).toBe(true);
	});
});
