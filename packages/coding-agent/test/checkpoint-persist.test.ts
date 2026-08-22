import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("0.5.0 session JSONL checkpoints", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("skips capture in dry-run so hasUndoableEdits stays false", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "existing.ts");
		writeFileSync(file, "export const x = 1;\n", "utf-8");
		harness.session.setDryRun(true);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "existing.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[fauxToolCall("edit", { path: "existing.ts", edits: [{ oldText: "1", newText: "99" }] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("dry"),
		]);
		await harness.session.prompt("edit dry");
		expect(readFileSync(file, "utf-8")).toContain("1");
		expect(harness.session.hasUndoableEdits()).toBe(false);
	});

	it("reloads checkpoints from JSONL so undoToPrompt works after reopen", async () => {
		const project = join(tmpdir(), `trek-ckpt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(project, { recursive: true });
		const sessions = join(project, "sessions");
		mkdirSync(sessions, { recursive: true });
		writeFileSync(join(project, "existing.ts"), "export const x = 1;\n", "utf-8");

		const sm1 = SessionManager.create(project, sessions);
		const h1 = await createHarness({ cwd: project, sessionManager: sm1 });
		harnesses.push(h1);
		h1.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "existing.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[fauxToolCall("edit", { path: "existing.ts", edits: [{ oldText: "1", newText: "10" }] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("p1"),
		]);
		await h1.session.prompt("to 10");
		expect(readFileSync(join(project, "existing.ts"), "utf-8")).toContain("10");
		expect(h1.session.hasUndoableEdits()).toBe(true);
		const sessionFile = sm1.getSessionFile();
		expect(sessionFile).toBeTruthy();
		expect(readFileSync(sessionFile as string, "utf-8")).toContain("trek:edit_batch_checkpoint");

		const sm2 = SessionManager.open(sessionFile as string, sessions, project);
		const h2 = await createHarness({ cwd: project, sessionManager: sm2 });
		harnesses.push(h2);
		expect(h2.session.hasUndoableEdits()).toBe(true);
		const undo = await h2.session.undoToPrompt(1);
		expect(undo.batchesUndone).toBeGreaterThanOrEqual(1);
		expect(readFileSync(join(project, "existing.ts"), "utf-8")).toContain("1");
	});
});
