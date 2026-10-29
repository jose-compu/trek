/**
 * 0.6.0 ROADMAP — diagnostic operator mode (#49)
 * Run: npx vitest run test/diagnostic-mode.test.ts --reporter=verbose
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { decideTool, operatorBlockReason } from "../src/core/safety/operator-mode.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

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

describe("diagnostic operator mode", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("blocks write and leaves the file unchanged", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "note.ts");
		writeFileSync(file, "keep\n", "utf-8");
		harness.session.setDiagnostic(true);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "note.ts", content: "mutated\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("blocked"),
		]);

		await harness.session.prompt("overwrite note.ts");
		expect(readFileSync(file, "utf-8")).toBe("keep\n");
		expect(harness.session.isDiagnostic()).toBe(true);
		expect(toolText(harness)).toContain("Diagnostic mode: write is blocked (mutating tools are not allowed).");
	});

	it("still allows read", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "README.md"), "# ok\n", "utf-8");
		harness.session.setDiagnostic(true);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("read ok"),
		]);
		await harness.session.prompt("read README");
		const text = toolText(harness);
		expect(text).toContain("# ok");
		expect(text).not.toContain("Diagnostic mode");
	});

	it("blocks edit and bash, and a grant or a confirmation does not open them", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const note = join(harness.tempDir, "note.ts");
		const touched = join(harness.tempDir, "touched.txt");
		writeFileSync(note, "keep\n", "utf-8");
		harness.session.setOperatorMode("diagnostic");
		harness.session.grantTool("bash");
		harness.session.grantTool("edit");
		harness.session.confirmTool("bash");
		harness.session.confirmTool("edit");
		let asked = false;
		harness.session.setToolConfirmHandler(() => {
			asked = true;
			return true;
		});
		expect(harness.session.isDiagnostic()).toBe(true);
		expect(harness.session.getOperatorMode()).toBe("diagnostic");

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("edit", { path: "note.ts", edits: [{ oldText: "keep\n", newText: "mutated\n" }] }),
					fauxToolCall("bash", { command: "printf mutated > touched.txt" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("both blocked"),
		]);
		await harness.session.prompt("edit the note and touch a file");
		expect(asked).toBe(false);
		expect(readFileSync(note, "utf-8")).toBe("keep\n");
		expect(existsSync(touched)).toBe(false);
		const text = toolText(harness);
		expect(text).toContain("Diagnostic mode: edit is blocked (mutating tools are not allowed).");
		expect(text).toContain("Diagnostic mode: bash is blocked (mutating tools are not allowed).");
		expect(text).not.toContain("Destructive shell command blocked");
		expect(assistantText(harness)).toContain("both blocked");
	});

	it("still allows grep once that free tool is active", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "plate.md"), "serial oxblood\n", "utf-8");
		harness.session.setDiagnostic(true);
		harness.session.setActiveToolsByName(["read", "grep", "bash", "edit", "write"]);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("grep", { pattern: "oxblood", path: "plate.md" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("found"),
		]);
		await harness.session.prompt("find oxblood");
		const text = toolText(harness);
		expect(text).toContain("oxblood");
		expect(text).not.toContain("Diagnostic mode");
	});

	it("blocks a destructive bash as diagnostic, not as Law 1", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.setDiagnostic(true);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /tmp/trek-diagnostic" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("stopped"),
		]);
		await harness.session.prompt("remove the scratch dir");
		const text = toolText(harness);
		expect(text).toContain("Diagnostic mode: bash is blocked (mutating tools are not allowed).");
		expect(text).not.toContain("Law 1");
	});

	it("turning diagnostic off lets the next write through, and supervised replaces it", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "fresh.ts");
		harness.session.setDiagnostic(true);
		harness.session.setDiagnostic(false);
		expect(harness.session.isDiagnostic()).toBe(false);
		expect(harness.session.getOperatorMode()).toBeUndefined();
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "fresh.ts", content: "written\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("wrote"),
		]);
		await harness.session.prompt("write the note");
		expect(readFileSync(file, "utf-8")).toBe("written\n");
		expect(toolText(harness)).not.toContain("Diagnostic mode");

		harness.session.setDiagnostic(true);
		harness.session.setOperatorMode("supervised");
		expect(harness.session.isDiagnostic()).toBe(false);
		expect(harness.session.getOperatorMode()).toBe("supervised");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "echo trek-diagnostic" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("waiting"),
		]);
		await harness.session.prompt("run echo");
		expect(toolText(harness)).toContain("Supervised mode: bash is gated and waits for confirmation.");
		expect(toolText(harness)).not.toContain("Diagnostic mode: bash");
	});
});

describe("diagnostic decisions", () => {
	const grant = new Set(["bash", "write", "edit"]);

	it("runs free tools and blocks cheap, gated, and forbidden tools", () => {
		expect(decideTool("diagnostic", "free", "read", grant)).toBe("run");
		expect(decideTool("diagnostic", "free", "grep", grant)).toBe("run");
		expect(decideTool("diagnostic", "cheap", "write", grant)).toBe("block");
		expect(decideTool("diagnostic", "cheap", "edit", grant)).toBe("block");
		expect(decideTool("diagnostic", "gated", "bash", grant)).toBe("block");
		expect(decideTool("diagnostic", "forbidden", "bash", grant)).toBe("block");
		expect(operatorBlockReason("diagnostic", "write", "cheap", "block")).toBe(
			"Diagnostic mode: write is blocked (mutating tools are not allowed).",
		);
		expect(operatorBlockReason("diagnostic", "edit", "cheap", "block")).toBe(
			"Diagnostic mode: edit is blocked (mutating tools are not allowed).",
		);
		expect(operatorBlockReason("diagnostic", "bash", "gated", "block")).toBe(
			"Diagnostic mode: bash is blocked (mutating tools are not allowed).",
		);
		expect(operatorBlockReason("diagnostic", "read", "free", "run")).toBeUndefined();
	});
});
