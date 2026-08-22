/**
 * 0.5.0 ROADMAP test gate — mocked LLM.
 * Run: npx vitest run test/undo-history.test.ts --reporter=verbose
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { handleHistoryCommand, handleRevertCommand } from "../src/history-cli.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("0.5.0 Undo history gate", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("edits a file across 3 prompts; revert --prompt 1 restores first content", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "counter.ts");
		writeFileSync(file, "export const x = 0;\n", "utf-8");

		const turns: Array<{ oldText: string; newText: string; user: string }> = [
			{ oldText: "0", newText: "1", user: "to 1" },
			{ oldText: "1", newText: "2", user: "to 2" },
			{ oldText: "2", newText: "3", user: "to 3" },
		];
		for (const turn of turns) {
			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("read", { path: "counter.ts" })], { stopReason: "toolUse" }),
				fauxAssistantMessage(
					[
						fauxToolCall("edit", {
							path: "counter.ts",
							edits: [{ oldText: turn.oldText, newText: turn.newText }],
						}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(turn.user),
			]);
			await harness.session.prompt(turn.user);
		}
		expect(readFileSync(file, "utf-8")).toContain("3");

		const restored = await harness.session.getTrekStore().restoreToPrompt(1);
		expect(restored.restored).toContain("counter.ts");
		expect(readFileSync(file, "utf-8")).toContain("0");
	});

	it("delete via write-then-rm snapshot restores from .trek", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "keep.ts"), "secret\n", "utf-8");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "keep.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm keep.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("deleted"),
		]);
		await harness.session.prompt("delete keep.ts");
		expect(() => readFileSync(join(harness.tempDir, "keep.ts"), "utf-8")).toThrow();
		const result = await harness.session.getTrekStore().restoreToPrompt(1);
		expect(result.restored).toContain("keep.ts");
		expect(readFileSync(join(harness.tempDir, "keep.ts"), "utf-8")).toContain("secret");
	});

	it("gated destructive bash without confirmation does not execute", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /important" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("blocked"),
		]);
		await harness.session.prompt("destroy");
		const text = harness.session.messages
			.filter((m) => m.role === "toolResult")
			.flatMap((m) => m.content)
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		expect(text).toMatch(/Law 1|Destructive|blocked/i);
	});

	it("duplicate write in the same prompt is idempotent", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "once.ts", content: "a" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("write", { path: "once.ts", content: "a" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("wrote"),
		]);
		await harness.session.prompt("write twice");
		expect(readFileSync(join(harness.tempDir, "once.ts"), "utf-8")).toBe("a");
		const results = harness.session.messages.filter((m) => m.role === "toolResult");
		expect(results.some((m) => m.content.some((c) => c.type === "text" && c.text.includes("[idempotent]")))).toBe(
			true,
		);
	});

	it("fixture CLI history and revert (no LLM)", async () => {
		const dir = join(tmpdir(), `trek-hist-${Date.now()}`);
		mkdirSync(join(dir, ".trek", "versions", "x.ts"), { recursive: true });
		writeFileSync(join(dir, "x.ts"), "after\n", "utf-8");
		writeFileSync(
			join(dir, ".trek", "versions", "x.ts", "v1.json"),
			JSON.stringify({
				kind: "edit",
				path: "x.ts",
				promptNumber: 1,
				promptId: "#1",
				stepId: "#1:x.ts",
				before: { kind: "content", content: "before\n" },
			}),
			"utf-8",
		);
		writeFileSync(
			join(dir, ".trek", "manifest.json"),
			JSON.stringify({
				version: 1,
				prompts: {
					"1": {
						promptId: "#1",
						stepId: "#1:x.ts",
						files: [{ path: "x.ts", from: 0, to: 1, kind: "edit", artifact: "versions/x.ts/v1.json" }],
					},
				},
			}),
			"utf-8",
		);

		const prev = process.cwd();
		process.chdir(dir);
		try {
			const okHist = await handleHistoryCommand(["history"]);
			expect(okHist).toBe(true);
			const okRev = await handleRevertCommand(["revert", "--prompt", "1"]);
			expect(okRev).toBe(true);
			expect(readFileSync(join(dir, "x.ts"), "utf-8")).toBe("before\n");
		} finally {
			process.chdir(prev);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("optional labeled git commit records SHA in manifest", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		execFileSync("git", ["init"], { cwd: harness.tempDir });
		execFileSync("git", ["config", "user.email", "trek@test"], { cwd: harness.tempDir });
		execFileSync("git", ["config", "user.name", "Trek Test"], { cwd: harness.tempDir });
		writeFileSync(join(harness.tempDir, "tracked.ts"), "v0\n", "utf-8");
		execFileSync("git", ["add", "tracked.ts"], { cwd: harness.tempDir });
		execFileSync("git", ["commit", "-m", "init"], { cwd: harness.tempDir });

		harness.session.setGitCommit(true);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "tracked.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				[fauxToolCall("edit", { path: "tracked.ts", edits: [{ oldText: "v0", newText: "v1" }] })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("committed"),
		]);
		await harness.session.prompt("edit tracked");
		const rows = await harness.session.getTrekStore().list();
		expect(rows.some((r) => r.git?.commit && r.path === "tracked.ts")).toBe(true);
	});
});
