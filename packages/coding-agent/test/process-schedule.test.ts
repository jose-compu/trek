/**
 * Algebra schedule benchmark (0.10.0). Fake delays, no network.
 * Run: npx vitest run test/process-schedule.test.ts --reporter=verbose
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildProcessTree,
	composePromptTree,
	guardedChoice,
	type ProcessNode,
	planToolGroups,
	revertInOrder,
	runToolSchedule,
	type ScheduledCall,
} from "../src/core/algebra/process-schedule.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const DELAY_MS = 80;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function shape(node: ProcessNode): unknown {
	return {
		pattern: node.pattern,
		seed: node.seed,
		label: node.label,
		children: node.children.map((child) => shape(child)),
	};
}

describe("process schedule", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("records one tool and keeps later one-tool turns in order", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "a", newText: "b" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("read then edit");

		const tree = harness.session.formatProcesses();
		console.log(tree);
		expect(tree).toMatch(/sequence/);
		expect(tree).toMatch(/parallel .* read a.txt/);
		expect(tree).toMatch(/inversion .* edit a.txt/);
		expect(tree).toMatch(/seed 42/);
		const composed = composePromptTree(
			[[{ id: "1", name: "read", args: { path: "a.txt" } }], [{ id: "2", name: "edit", args: { path: "a.txt" } }]],
			42,
		);
		expect(composed?.pattern).toBe("sequence");
		expect(composed?.children.map((child) => child.pattern)).toEqual(["parallel", "inversion"]);
	});

	it("keeps custom tools in one parallel group", () => {
		const groups = planToolGroups([
			{ id: "1", name: "dummy", args: { q: "x" } },
			{ id: "2", name: "dummy", args: { q: "y" } },
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.map((call) => call.id)).toEqual(["1", "2"]);
	});

	it("runs three reads in parallel in under half the sequential time", async () => {
		const calls: ScheduledCall[] = [
			{ id: "1", name: "read", args: { path: "a.lean" } },
			{ id: "2", name: "read", args: { path: "b.lean" } },
			{ id: "3", name: "read", args: { path: "c.lean" } },
		];
		const parallel = await runToolSchedule({
			seed: 42,
			calls,
			run: async () => {
				await sleep(DELAY_MS);
				return "ok";
			},
		});
		const sequentialStarted = performance.now();
		for (const call of calls) {
			await sleep(DELAY_MS);
			expect(call.id).toBeTruthy();
		}
		const sequentialMs = performance.now() - sequentialStarted;
		console.log("parallel reads ms", parallel.elapsedMs, "sequential ms", Math.round(sequentialMs));
		expect(parallel.schedulerUsed).toBe(true);
		expect(parallel.tree.pattern).toBe("parallel");
		expect(parallel.tree.seed).toBe(42);
		expect(parallel.elapsedMs).toBeLessThan(sequentialMs / 2);
	});

	it("overlaps edits of different files and keeps one file serial", async () => {
		const different: ScheduledCall[] = [
			{ id: "a", name: "edit", args: { path: "a.txt" } },
			{ id: "b", name: "edit", args: { path: "b.txt" } },
		];
		const started: string[] = [];
		const overlapped = await runToolSchedule({
			seed: 42,
			calls: different,
			run: async (call) => {
				started.push(`start ${call.id}`);
				await sleep(DELAY_MS);
				started.push(`end ${call.id}`);
				return call.id;
			},
		});
		console.log("different files ms", overlapped.elapsedMs, started.join(","));
		expect(started[0]).toMatch(/^start /);
		expect(started[1]).toMatch(/^start /);
		expect(overlapped.elapsedMs).toBeLessThan(DELAY_MS * 1.8);

		let text = "v0";
		const same: ScheduledCall[] = [
			{ id: "first", name: "edit", args: { path: "a.txt" } },
			{ id: "second", name: "edit", args: { path: "a.txt" } },
		];
		const serial = await runToolSchedule({
			seed: 42,
			calls: same,
			run: async (call) => {
				const seen = text;
				await sleep(DELAY_MS);
				text = `${seen}>${call.id}`;
				return seen;
			},
		});
		console.log("same file ms", serial.elapsedMs, "text", text);
		expect(serial.values).toEqual(["v0", "v0>first"]);
		expect(text).toBe("v0>first>second");
		expect(serial.tree.pattern).toBe("sequence");
		expect(serial.elapsedMs).toBeGreaterThan(DELAY_MS * 1.5);
	});

	it("keeps the same grouping for the same seed", async () => {
		const calls: ScheduledCall[] = [
			{ id: "1", name: "read", args: { path: "a.txt" } },
			{ id: "2", name: "grep", args: { pattern: "Nat" } },
			{ id: "3", name: "edit", args: { path: "b.txt" } },
			{ id: "4", name: "bash", args: { command: "rm old.txt" } },
			{ id: "5", name: "read", args: { path: "c.txt" } },
		];
		const first = planToolGroups(calls);
		const second = planToolGroups(calls);
		expect(second).toEqual(first);
		expect(first[0]?.map((call) => call.id)).toEqual(["1", "2", "3"]);
		expect(first[1]?.map((call) => call.id)).toEqual(["4"]);
		expect(first[2]?.map((call) => call.id)).toEqual(["5"]);
		const treeA = await runToolSchedule({ seed: 42, calls, run: async () => "ok" });
		const treeB = await runToolSchedule({ seed: 42, calls, run: async () => "ok" });
		expect(shape(treeB.tree)).toEqual(shape(treeA.tree));
		expect(buildProcessTree(calls, 42).seed).toBe(42);
	});

	it("skips the scheduler for one tool", async () => {
		const result = await runToolSchedule({
			seed: 42,
			calls: [{ id: "only", name: "read", args: { path: "a.txt" } }],
			run: async () => "ok",
		});
		console.log("one tool ms", result.elapsedMs, "scheduler", result.schedulerUsed);
		expect(result.schedulerUsed).toBe(false);
		expect(result.elapsedMs).toBeLessThan(5);
		expect(result.values).toEqual(["ok"]);
	});

	it("picks the same guarded branch for the same seed", () => {
		const branches = [
			{ name: "left", when: true, value: 1 },
			{ name: "right", when: true, value: 2 },
		];
		expect(guardedChoice(42, branches)?.name).toBe(guardedChoice(42, branches)?.name);
		expect(guardedChoice(42, [{ name: "only", when: true, value: 1 }])?.name).toBe("only");
		expect(guardedChoice(42, [{ name: "closed", when: false, value: 1 }])).toBeUndefined();
	});

	it("restores prior bytes by inverse, then trek, then git", async () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-invert-"));
		const file = join(dir, "note.txt");
		writeFileSync(file, "before\n");
		const order: string[] = [];
		const scheduled = await runToolSchedule({
			seed: 42,
			calls: [{ id: "w", name: "write", args: { path: file } }],
			inverseFor: () => async () => {
				order.push("inverse");
				writeFileSync(file, "before\n");
			},
			trek: async () => {
				order.push("trek");
			},
			git: async () => {
				order.push("git");
			},
			run: async () => {
				writeFileSync(file, "after\n");
				return "wrote";
			},
		});
		expect(readFileSync(file, "utf-8")).toBe("after\n");
		expect(scheduled.schedulerUsed).toBe(false);
		expect(scheduled.tree.pattern).toBe("inversion");
		await scheduled.revert();
		expect(readFileSync(file, "utf-8")).toBe("before\n");
		expect(order).toEqual(["inverse", "trek", "git"]);

		const steps: string[] = [];
		await revertInOrder({
			inverse: async () => {
				steps.push("inverse");
			},
			trek: async () => {
				steps.push("trek");
			},
			git: async () => {
				steps.push("git");
			},
		});
		expect(steps).toEqual(["inverse", "trek", "git"]);
	});
});
