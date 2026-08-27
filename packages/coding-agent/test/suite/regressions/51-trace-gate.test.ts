/**
 * 0.6.0 Trace acceptance gate (#51). Faux LLM only.
 * Run: npx vitest run test/suite/regressions/51-trace-gate.test.ts --reporter=verbose
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session-manager.ts";
import {
	COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE,
	diffIntentionOutcome,
	findCycleTrace,
	forkLeafId,
	getReflectiveCycleTraces,
	replayCounterfactual,
} from "../../../src/core/trace/index.ts";
import { createHarness, type Harness } from "../harness.ts";

function readTurn(): ReturnType<typeof fauxAssistantMessage>[] {
	return [
		fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	];
}

describe("regression #51: 0.6.0 Trace acceptance", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("forks from cycle 5, keeps laws pre/post, diffs intention vs outcome, and replays observe", async () => {
		const cwd = join(tmpdir(), `trek-trace-gate-${Date.now()}`);
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(cwd, "README.md"), "# fixture\n", "utf-8");
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir);

		const live = await createHarness({
			cwd,
			enableReflectiveLoop: true,
			sessionManager: SessionManager.create(cwd, sessionDir),
		});
		harnesses.push(live);

		for (let i = 1; i <= 5; i++) {
			live.setResponses(readTurn());
			await live.session.prompt(`turn ${i}`);
		}

		const traces = getReflectiveCycleTraces(live.sessionManager.getEntries());
		expect(traces.map((t) => t.cycleId)).toEqual(["c-0001", "c-0002", "c-0003", "c-0004", "c-0005"]);
		expect(traces[0]?.lawsVerdict.pre?.allowed).toBe(true);
		expect(traces[0]?.lawsVerdict.post?.allowed).toBe(true);
		expect(traces[0]?.toolNames).toContain("read");

		const diff = diffIntentionOutcome(traces[0]!);
		expect(diff.status).toBe("diverged");
		expect(diff.intend.length).toBeGreaterThan(0);
		expect(diff.act.length).toBeGreaterThan(0);

		const sourcePath = live.sessionManager.getSessionFile();
		expect(sourcePath).toBeTruthy();
		const source = SessionManager.open(sourcePath!);
		const located = findCycleTrace(source.getEntries(), "c-0005");
		expect(located).toBeDefined();
		const forkedPath = source.createBranchedSession(forkLeafId(source.getEntries(), located!));
		expect(forkedPath).toBeTruthy();
		expect(forkedPath).not.toBe(sourcePath);

		const child = SessionManager.open(forkedPath!);
		expect(getReflectiveCycleTraces(child.getEntries()).map((t) => t.cycleId)).toEqual([
			"c-0001",
			"c-0002",
			"c-0003",
			"c-0004",
			"c-0005",
		]);
		expect(child.getNextPromptNumber()).toBe(6);
		expect(child.getHeader()?.parentSession).toBe(sourcePath);

		const continued = await createHarness({
			cwd,
			enableReflectiveLoop: true,
			sessionManager: child,
		});
		harnesses.push(continued);
		continued.setResponses(readTurn());
		await continued.session.prompt("turn 6");
		expect(getReflectiveCycleTraces(child.getEntries()).map((t) => t.cycleId)).toContain("c-0006");
		expect(child.getNextPromptNumber()).toBe(7);

		const replaySource = SessionManager.open(sourcePath!);
		const replayed = replayCounterfactual(replaySource, "c-0001", "patched observation");
		const replaySession = SessionManager.open(replayed.path);
		const injected = replaySession
			.getEntries()
			.find((e) => e.type === "custom" && e.customType === COUNTERFACTUAL_OBSERVE_CUSTOM_TYPE);
		expect(injected).toBeDefined();
		expect((injected as { data?: { observe?: string } }).data?.observe).toBe("patched observation");
	});
});
