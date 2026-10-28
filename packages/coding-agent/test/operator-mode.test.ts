/**
 * 0.13 operator modes. Laws stay in force. The mode only decides the extra gate.
 * Run: PI_NO_LOCAL_LLM=1 npx vitest --run test/operator-mode.test.ts --reporter=verbose
 */

import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { ReflectiveLoopController } from "../src/core/reflective-loop/loop-controller.ts";
import { decideTool } from "../src/core/safety/operator-mode.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("operator mode decisions", () => {
	const grant = new Set(["bash"]);

	it("supervised runs cheap tools and waits on gated tools", () => {
		expect(decideTool("supervised", "free", "read", grant)).toBe("run");
		expect(decideTool("supervised", "cheap", "write", grant)).toBe("run");
		expect(decideTool("supervised", "gated", "bash", grant)).toBe("confirm");
		expect(decideTool("supervised", "forbidden", "bash", grant)).toBe("block");
	});

	it("delegated runs a granted gated tool and waits on the rest", () => {
		expect(decideTool("delegated", "gated", "bash", grant)).toBe("run");
		expect(decideTool("delegated", "gated", "other", grant)).toBe("confirm");
		expect(decideTool("delegated", "forbidden", "bash", grant)).toBe("block");
	});

	it("diagnostic runs only free tools", () => {
		expect(decideTool("diagnostic", "free", "read", grant)).toBe("run");
		expect(decideTool("diagnostic", "cheap", "write", grant)).toBe("block");
		expect(decideTool("diagnostic", "gated", "bash", grant)).toBe("block");
	});
});

describe("operator mode session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("supervised blocks bash until one confirmation", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.setOperatorMode("supervised");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-operator" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("waiting"),
		]);
		await harness.session.prompt("run echo");
		expect(toolText(harness)).toContain("Supervised mode: bash is gated and waits for confirmation.");

		harness.session.confirmTool("bash");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-operator" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("ran"),
		]);
		await harness.session.prompt("run echo again");
		expect(toolText(harness)).toContain("trek-operator");
	});

	it("delegated runs a pre-authorized bash and waits on one that is not granted", async () => {
		const blocked = await createHarness();
		harnesses.push(blocked);
		blocked.session.setOperatorMode("delegated");
		blocked.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-operator" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("no grant"),
		]);
		await blocked.session.prompt("run echo");
		expect(toolText(blocked)).toContain("Delegated mode: bash is gated and is not in the grant.");

		const granted = await createHarness();
		harnesses.push(granted);
		granted.session.setOperatorMode("delegated");
		granted.session.grantTool("bash");
		granted.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-operator" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("granted"),
		]);
		await granted.session.prompt("run echo");
		expect(toolText(granted)).toContain("trek-operator");
		expect(toolText(granted)).not.toContain("not in the grant");
	});
});

describe("checkpoint phase gate", () => {
	it("does not enter act until the phase is open", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const controller = new ReflectiveLoopController(manager);
		let acted = false;
		await expect(
			controller.runPromptCycle({
				task: "Read the project notes.",
				cwd: process.cwd(),
				messageCount: 0,
				getMessageCount: () => 0,
				act: async () => {
					acted = true;
				},
				phaseAllowed: () => false,
			}),
		).rejects.toThrow(/act phase is closed/);
		expect(acted).toBe(false);

		await controller.runPromptCycle({
			task: "Read the project notes.",
			cwd: process.cwd(),
			messageCount: 0,
			getMessageCount: () => 0,
			act: async () => {
				acted = true;
			},
			phaseAllowed: () => true,
		});
		expect(acted).toBe(true);
	});
});

function toolText(harness: Harness): string {
	const lines: string[] = [];
	for (const message of harness.session.messages) {
		if (message.role !== "toolResult") continue;
		for (const part of message.content) {
			if (part.type === "text") lines.push(part.text);
		}
	}
	return lines.join("\n");
}
