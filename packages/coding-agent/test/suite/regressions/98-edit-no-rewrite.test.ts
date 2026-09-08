/**
 * Duplicate or already-applied edits must not push the model to rewrite the file.
 * Run: node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/98-edit-no-rewrite.test.ts --reporter=verbose
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

function toolTexts(harness: Harness, toolName: string): string[] {
	return harness.session.messages
		.filter((message) => message.role === "toolResult")
		.filter((message) => message.toolName === toolName)
		.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text));
}

describe("regression #98: edit must not trigger a full rewrite", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("replays a successful duplicate edit as already applied, not skipped", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const editArgs = {
			path: "run_spice.py",
			edits: [{ oldText: "plot_d1", newText: "plot_d2" }],
		};
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "run_spice.py", content: "plot_d1\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("edit", editArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", editArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("change plot");

		expect(readFileSync(join(harness.tempDir, "run_spice.py"), "utf-8")).toBe("plot_d2\n");
		const texts = toolTexts(harness, "edit");
		expect(texts).toHaveLength(2);
		expect(texts[0]).toMatch(/Successfully replaced/);
		expect(texts[1]).toMatch(/already applied in this prompt/);
		expect(texts[1]).toMatch(/Do not rewrite the file/);
		expect(texts.some((text) => /idempotent|skipped/i.test(text))).toBe(false);
	});

	it("re-runs a failed edit so the model can retry after a re-read", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const editArgs = {
			path: "run_spice.py",
			edits: [{ oldText: "missing", newText: "plot_d2" }],
		};
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "run_spice.py", content: "plot_d1\n" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("edit", editArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", editArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("retry edit");

		expect(readFileSync(join(harness.tempDir, "run_spice.py"), "utf-8")).toBe("plot_d1\n");
		const texts = toolTexts(harness, "edit");
		expect(texts).toHaveLength(2);
		expect(texts[0]).toMatch(/Could not find the exact text/);
		expect(texts[1]).toMatch(/Could not find the exact text/);
		expect(texts.some((text) => /already applied|already completed|skipped|idempotent/i.test(text))).toBe(false);
	});

	it("re-runs a cached edit when oldText is still in the file", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const models = [
			".model DBODY D(Is=8e-12 Rs=6m N=1.1 Cjo=700p Tt=40n BV=40 Ibv=50m)",
			".model DPULSE D(Is=3e-12 Rs=12m N=1.08 Cjo=150p Tt=18n BV=120 Ibv=10m)",
			"",
		].join("\n");
		const restored = `* restored\n${models}`;
		const editArgs = {
			path: "models.inc",
			edits: [
				{
					oldText: ".model DBODY D(Is=8e-12 Rs=6m N=1.1 Cjo=700p Tt=40n BV=40 Ibv=50m)",
					newText: ".model DSICbody D(Is=8e-12 Rs=6m N=1.1 Cjo=700p Tt=40n BV=80 Ibv=50m)",
				},
			],
		};
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "models.inc", content: models })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("edit", editArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("write", { path: "models.inc", content: restored })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("edit", editArgs)], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("remove DBODY");

		const content = readFileSync(join(harness.tempDir, "models.inc"), "utf-8");
		expect(content).toContain(".model DSICbody");
		expect(content).not.toContain(".model DBODY");
		const texts = toolTexts(harness, "edit");
		expect(texts).toHaveLength(2);
		expect(texts[0]).toMatch(/Successfully replaced/);
		expect(texts[1]).toMatch(/Successfully replaced/);
		expect(texts.some((text) => /already applied/i.test(text))).toBe(false);
	});
});
