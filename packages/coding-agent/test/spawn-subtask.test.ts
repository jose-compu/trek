/**
 * Intention repair and depth-first spawn_subtask (0.9.0).
 * Run: npx vitest run test/spawn-subtask.test.ts --reporter=verbose
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { runIntentionFilter } from "../src/core/reflective-loop/components.ts";
import { runDepthFirstSubtask } from "../src/core/reflective-loop/spawn-subtask.ts";
import { SubtaskStack } from "../src/core/reflective-loop/subtask-stack.ts";
import { defaultRuntimeConfig, resolveRuntime, withHierarchy } from "../src/core/runtime/index.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function localResolved() {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
		frontier: null,
	});
}

describe("intention repair and spawn_subtask", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("repairs an intention with no next action and still runs one tool call", async () => {
		const repaired = runIntentionFilter({
			summary: "Intend to address: hello",
			task: "hello",
			requiresSubtasks: false,
		});
		expect(repaired.intention.summary).toMatch(/Next action: use a tool/);

		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "note.txt"), "hi\n");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "note.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("hello");

		const reads = harness.session.messages.filter(
			(message) => message.role === "toolResult" && message.toolName === "read",
		);
		expect(reads).toHaveLength(1);
	});

	it("routes a child step and aborts at depth 6", () => {
		const resolved = localResolved();
		const stack = new SubtaskStack();
		const child = runDepthFirstSubtask(stack, {
			description: "rename the helper",
			summary: "parent summary only",
			resolved,
		});
		expect(child.context).toBe("summary_only");
		expect(child.summary).toBe("parent summary only");
		expect(child.depth).toBe(1);
		expect(child.role).toBe("tooling");
		expect(child.modelId).toBe("Qwen3.5-0.8B");
		expect(stack.depth).toBe(0);

		const built = runDepthFirstSubtask(stack, {
			description: "build the chess page",
			summary: "parent summary only",
			resolved,
		});
		expect(built.role).toBe("planning");
		expect(built.modelId).toBe("Ministral-3-8B-Reasoning-2512");

		const dive = (n: number): void => {
			runDepthFirstSubtask(stack, {
				description: `depth-${n}`,
				summary: "parent summary only",
				resolved,
				runChild: () => {
					if (n < 6) {
						dive(n + 1);
					}
				},
			});
		};
		expect(() => dive(1)).toThrow("Subtask depth limit (5) exceeded.");
		expect(stack.depth).toBe(0);
	});
});
