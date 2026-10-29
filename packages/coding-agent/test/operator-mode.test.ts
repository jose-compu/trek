/**
 * 0.13 operator modes. Laws stay in force. The mode only decides the extra gate.
 * Run: PI_NO_LOCAL_LLM=1 npx vitest --run test/operator-mode.test.ts --reporter=verbose
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { ReflectiveLoopController } from "../src/core/reflective-loop/loop-controller.ts";
import { decideTool, operatorBlockReason, phaseIsOpen } from "../src/core/safety/operator-mode.ts";
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

	it("ask reads files and the web, and does not write", () => {
		expect(decideTool("ask", "free", "read", grant)).toBe("run");
		expect(decideTool("ask", "free", "grep", grant)).toBe("run");
		expect(decideTool("ask", "gated", "webfetch", grant)).toBe("run");
		expect(decideTool("ask", "gated", "web_search", grant)).toBe("run");
		expect(decideTool("ask", "gated", "recall", grant)).toBe("run");
		expect(decideTool("ask", "cheap", "write", grant)).toBe("block");
		expect(decideTool("ask", "cheap", "edit", grant)).toBe("block");
		expect(decideTool("ask", "gated", "bash", grant)).toBe("block");
		expect(decideTool("ask", "gated", "remember", grant)).toBe("block");
		expect(decideTool("ask", "forbidden", "bash", grant)).toBe("block");
		expect(operatorBlockReason("ask", "write", "cheap", "block")).toBe(
			"Ask mode: write is blocked. This mode reads files and the web, and does not write.",
		);
		expect(phaseIsOpen("ask", "act", new Set())).toBe(true);
		expect(phaseIsOpen("checkpoint", "act", new Set())).toBe(false);
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

	it("supervised runs bash when the confirm handler says yes, and stays blocked when it says no", async () => {
		const allowed = await createHarness();
		harnesses.push(allowed);
		allowed.session.setOperatorMode("supervised");
		allowed.session.setToolConfirmHandler(async (toolName, detail) => {
			expect(toolName).toBe("bash");
			expect(detail).toContain("echo trek-yes");
			return true;
		});
		allowed.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-yes" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("ran"),
		]);
		await allowed.session.prompt("run echo");
		expect(toolText(allowed)).toContain("trek-yes");
		expect(toolText(allowed)).not.toContain("waits for confirmation");

		const denied = await createHarness();
		harnesses.push(denied);
		denied.session.setOperatorMode("supervised");
		denied.session.setToolConfirmHandler(async () => false);
		denied.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-no" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("blocked"),
		]);
		await denied.session.prompt("run echo");
		expect(toolText(denied)).toContain("Supervised mode: bash is gated and waits for confirmation.");
		expect(toolText(denied)).not.toContain("trek-no");
	});

	it("delegated does not ask, even when a confirm handler is set", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.setOperatorMode("delegated");
		let asked = false;
		harness.session.setToolConfirmHandler(() => {
			asked = true;
			return true;
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-operator" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("no grant"),
		]);
		await harness.session.prompt("run echo");
		expect(asked).toBe(false);
		expect(toolText(harness)).toContain("Delegated mode: bash is gated and is not in the grant.");
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

describe("ask mode", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("answers and reads, and a grant or a confirmation does not open a write", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const note = join(harness.tempDir, "note.ts");
		const touched = join(harness.tempDir, "touched.txt");
		writeFileSync(note, "keep\n", "utf-8");
		harness.session.setOperatorMode("ask");
		harness.session.grantTool("bash");
		harness.session.grantTool("write");
		harness.session.confirmTool("bash");
		harness.session.confirmTool("write");
		let asked = false;
		harness.session.setToolConfirmHandler(() => {
			asked = true;
			return true;
		});
		expect(harness.session.isDiagnostic()).toBe(false);
		expect(harness.session.getOperatorMode()).toBe("ask");

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "note.ts", content: "mutated\n" }),
					fauxToolCall("bash", { command: "printf mutated > touched.txt" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("the note still says keep"),
		]);
		await harness.session.prompt("change the note");
		expect(asked).toBe(false);
		expect(readFileSync(note, "utf-8")).toBe("keep\n");
		expect(existsSync(touched)).toBe(false);
		expect(toolText(harness)).toContain(
			"Ask mode: write is blocked. This mode reads files and the web, and does not write.",
		);
		expect(toolText(harness)).toContain(
			"Ask mode: bash is blocked. This mode reads files and the web, and does not write.",
		);
		expect(assistantText(harness)).toContain("the note still says keep");

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "note.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("read the note"),
		]);
		await harness.session.prompt("what is in the note");
		expect(toolText(harness)).toContain("keep");
		expect(toolText(harness)).not.toContain("Ask mode: read");
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

function assistantText(harness: Harness): string {
	const lines: string[] = [];
	for (const message of harness.session.messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") lines.push(part.text);
		}
	}
	return lines.join("\n");
}

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
