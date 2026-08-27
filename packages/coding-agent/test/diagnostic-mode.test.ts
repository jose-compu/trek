/**
 * 0.6.0 ROADMAP — diagnostic operator mode (#49)
 * Run: npx vitest run test/diagnostic-mode.test.ts --reporter=verbose
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";

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
		expect(harness.session.messages.some((m) => m.role === "toolResult")).toBe(true);
	});
});
