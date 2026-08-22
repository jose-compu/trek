import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";
import { ScriptedOperator } from "./suite/scripted-operator.ts";

function editTurn(oldText: string, newText: string) {
	return [
		fauxAssistantMessage([fauxToolCall("read", { path: "n.ts" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("edit", { path: "n.ts", edits: [{ oldText, newText }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage(`now ${newText}`),
	];
}

describe("scripted mock operator", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("two-prompt edit then shift+ctrl+z restores last batch", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "n.ts");
		writeFileSync(file, "x=0\n", "utf-8");
		const op = new ScriptedOperator(harness);
		expect(op.chord("app.edits.undo")).toBe("shift+ctrl+z");
		await op.run([
			{ user: "to 1", faux: editTurn("0", "1") },
			{ user: "to 2", faux: editTurn("1", "2"), after: ["app.edits.undo"] },
		]);
		expect(readFileSync(file, "utf-8")).toContain("1");
	});

	it("three-prompt edit, /undo select #1 restores original", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "n.ts");
		writeFileSync(file, "x=0\n", "utf-8");
		const op = new ScriptedOperator(harness);
		await op.submit("to 1", editTurn("0", "1"));
		await op.submit("to 2", editTurn("1", "2"));
		await op.submit("to 3", editTurn("2", "3"));
		expect(readFileSync(file, "utf-8")).toContain("3");
		await op.slashUndo(1);
		expect(readFileSync(file, "utf-8")).toContain("0");
	});

	it("keep-all then undo is a no-op", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "n.ts");
		writeFileSync(file, "x=0\n", "utf-8");
		const op = new ScriptedOperator(harness);
		expect(op.chord("app.edits.keepAll")).toBe("shift+ctrl+k");
		await op.submit("to 1", editTurn("0", "1"));
		await op.shortcut("app.edits.keepAll");
		await op.shortcut("app.edits.undo");
		expect(readFileSync(file, "utf-8")).toContain("1");
		expect(harness.session.hasUndoableEdits()).toBe(false);
	});

	it("dry-run shortcut then faux edit does not mutate or create undo batch", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const file = join(harness.tempDir, "n.ts");
		writeFileSync(file, "x=0\n", "utf-8");
		const op = new ScriptedOperator(harness);
		expect(op.chord("app.edits.dryRun")).toBe("shift+ctrl+y");
		await op.shortcut("app.edits.dryRun");
		await op.submit("to 9", editTurn("0", "9"));
		expect(readFileSync(file, "utf-8")).toContain("0");
		expect(harness.session.hasUndoableEdits()).toBe(false);
	});

	it("complex transcript: honesty footer, schema-mismatch note path, then real edit", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "n.ts"), "x=0\n", "utf-8");
		const op = new ScriptedOperator(harness);
		await op.submit("inspect", [
			fauxAssistantMessage([fauxToolCall("read", { path: "n.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(
				"Looks like x is 0. from_training_unverified: the file is a counter.\n<honesty>\nconfidence: medium\nassumption: none\nunverified: file purpose\n</honesty>",
			),
		]);
		expect(harness.session.getLastHonestyReport().present).toBe(true);
		await op.submit("to 4", editTurn("0", "4"));
		expect(readFileSync(join(harness.tempDir, "n.ts"), "utf-8")).toContain("4");
	});
});
