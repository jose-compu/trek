/**
 * Live AgentSession path: on-disk JSONL must contain schema v1 cycle traces.
 * Run: npx vitest run test/trace-live-session.test.ts --reporter=verbose
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { REFLECTIVE_CYCLE_CUSTOM_TYPE, TRACE_SCHEMA_VERSION } from "../src/core/trace/index.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("live session trek:reflective_cycle schema v1", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("AgentSession.prompt writes schemaVersion 1 to the session JSONL file", async () => {
		const cwd = join(tmpdir(), `trek-trace-live-${Date.now()}`);
		mkdirSync(cwd, { recursive: true });
		tempDirs.push(cwd);
		writeFileSync(join(cwd, "README.md"), "# fixture\n", "utf8");

		const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			enableReflectiveLoop: true,
			sessionManager,
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read README");

		const sessionFile = harness.sessionManager.getSessionFile();
		expect(sessionFile).toBeTruthy();
		const raw = readFileSync(sessionFile!, "utf8");
		const cycleLines = raw
			.split("\n")
			.filter((line) => line.includes(`"customType":"${REFLECTIVE_CYCLE_CUSTOM_TYPE}"`));

		console.log("session file:", sessionFile);
		console.log("trek:reflective_cycle lines:\n", cycleLines.join("\n"));

		expect(cycleLines.length).toBeGreaterThanOrEqual(1);
		const entry = JSON.parse(cycleLines[0]!);
		expect(entry.customType).toBe(REFLECTIVE_CYCLE_CUSTOM_TYPE);
		expect(entry.data.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
		expect(entry.data.cycleId).toMatch(/^c-\d{4}$/);
		expect(entry.data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(entry.data.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(entry.data.lawsVerdict.pre.allowed).toBe(true);
		expect(entry.data.toolNames).toContain("read");
		expect(entry.data.phases.observe.phase).toBe("observe");
		expect(entry.data.phases.intend.phase).toBe("intend");
		expect(entry.data.phases.act.phase).toBe("act");
		expect(entry.data.phases.reflect.phase).toBe("reflect");
	});
});
