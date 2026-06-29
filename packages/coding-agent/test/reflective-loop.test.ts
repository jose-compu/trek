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
		expect(result.reason).toMatch(/Destructive shell pattern blocked/i);
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
		).rejects.toThrow(/Destructive shell pattern blocked/i);

		const persisted = getReflectiveCycleTraces(manager.getEntries());
		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.phases.intend.blocked).toBe(true);
		expect(persisted[0]?.phases.act.skipped).toBeUndefined();
	});
});
