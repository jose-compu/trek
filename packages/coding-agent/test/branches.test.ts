/**
 * 0.14.0 breadth-first branches: spawn_branches and gather.
 * Run: npx vitest run test/branches.test.ts --reporter=verbose
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@trek/ai";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	FileClaims,
	gatherBranches,
	MAX_BREADTH,
	planBranches,
	SerialQueue,
} from "../src/core/reflective-loop/branches.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const BRANCH_TOOLS = ["read", "bash", "edit", "write", "spawn_branches", "gather"];

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function branchId(context: Context): string | undefined {
	const first = context.messages.find((message) => message.role === "user");
	return first ? /You are branch (b\d+)/.exec(textOf(first.content))?.[1] : undefined;
}

function lastToolResult(context: Context): string | undefined {
	const last = context.messages[context.messages.length - 1];
	return last?.role === "toolResult" ? textOf(last.content) : undefined;
}

function toolResults(harness: Harness, toolName: string): string[] {
	return harness.session.messages.flatMap((message) =>
		message.role === "toolResult" && message.toolName === toolName ? [textOf(message.content)] : [],
	);
}

/** One factory answers the parent and every branch, so queue order does not matter. */
function script(
	count: number,
	parent: (context: Context) => ReturnType<typeof fauxAssistantMessage>,
	branch: (
		id: string,
		context: Context,
	) => ReturnType<typeof fauxAssistantMessage> | Promise<ReturnType<typeof fauxAssistantMessage>>,
) {
	return Array.from({ length: count }, () => (context: Context) => {
		const id = branchId(context);
		return id ? branch(id, context) : parent(context);
	});
}

function barrier(size: number, timeoutMs = 3000): () => Promise<void> {
	let arrived = 0;
	let open: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	return async () => {
		arrived += 1;
		if (arrived >= size) open();
		await Promise.race([
			gate,
			new Promise<void>((_, reject) =>
				setTimeout(() => reject(new Error(`only ${arrived} of ${size} branches ran at once`)), timeoutMs),
			),
		]);
	};
}

describe("branch helpers", () => {
	it("plans up to four branches and refuses five", () => {
		let n = 0;
		const next = () => `b${++n}`;
		const tasks = planBranches([{ description: "read a" }, { description: "read b", summary: "parent" }], next);
		expect(tasks).toEqual([
			{ id: "b1", description: "read a", summary: "read a" },
			{ id: "b2", description: "read b", summary: "parent" },
		]);
		expect(MAX_BREADTH).toBe(4);
		const five = Array.from({ length: 5 }, (_, i) => ({ description: `t${i}` }));
		expect(() => planBranches(five, next)).toThrow("Branch breadth limit (4) exceeded: 5 subtasks.");
		expect(() => planBranches([], next)).toThrow("spawn_branches needs at least one subtask.");
		expect(() => planBranches([{ description: "  " }], next)).toThrow("A branch subtask needs a description.");
	});

	it("gives a path to the first branch and keeps it", () => {
		const claims = new FileClaims();
		expect(claims.claim("/x/a.ts", "b1")).toEqual({ created: true });
		expect(claims.claim("/x/a.ts", "b1")).toEqual({ created: false });
		expect(claims.claim("/x/a.ts", "b2")).toEqual({ owner: "b1", created: false });
		claims.release("/x/a.ts", "b2");
		expect(claims.claim("/x/a.ts", "b2").owner).toBe("b1");
		claims.release("/x/a.ts", "b1");
		expect(claims.claim("/x/a.ts", "b2")).toEqual({ created: true });
	});

	it("runs queued tasks one at a time in order, after a failure too", async () => {
		const queue = new SerialQueue();
		const order: string[] = [];
		let running = 0;
		let overlap = false;
		const step = (name: string, fail = false) =>
			queue.run(async () => {
				running += 1;
				if (running > 1) overlap = true;
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push(name);
				running -= 1;
				if (fail) throw new Error(name);
				return name;
			});
		const results = await Promise.allSettled([step("one"), step("two", true), step("three")]);
		expect(order).toEqual(["one", "two", "three"]);
		expect(overlap).toBe(false);
		expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
	});

	it("gathers in the order asked and names an unknown id", () => {
		const store = new Map([
			["b1", { id: "b1", description: "read a", summary: "alpha", isError: false }],
			["b2", { id: "b2", description: "read b", summary: "beta", isError: true }],
		]);
		expect(gatherBranches(store, ["b2", "b1"])).toBe("b2 (error): read b\nbeta\n\nb1: read a\nalpha");
		expect(() => gatherBranches(store, ["b1", "b9"])).toThrow("unknown branch b9");
	});
});

describe("spawn_branches in a session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	async function branchHarness(): Promise<Harness> {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		harness.session.setActiveToolsByName(BRANCH_TOOLS);
		return harness;
	}

	it("runs three reads at once and gather merges them in order", async () => {
		const harness = await branchHarness();
		for (const [name, body] of [
			["a.txt", "alpha note"],
			["b.txt", "beta note"],
			["c.txt", "gamma note"],
		]) {
			writeFileSync(join(harness.tempDir, name), `${body}\n`);
		}
		const files: Record<string, string> = { b1: "a.txt", b2: "b.txt", b3: "c.txt" };
		const together = barrier(3);
		let parentStep = 0;
		harness.setResponses(
			script(
				9,
				() => {
					parentStep += 1;
					if (parentStep === 1) {
						return fauxAssistantMessage(
							[
								fauxToolCall("spawn_branches", {
									subtasks: [
										{ description: "read a.txt" },
										{ description: "read b.txt" },
										{ description: "read c.txt" },
									],
								}),
							],
							{ stopReason: "toolUse" },
						);
					}
					if (parentStep === 2) {
						return fauxAssistantMessage([fauxToolCall("gather", { subtask_ids: ["b3", "b1"] })], {
							stopReason: "toolUse",
						});
					}
					return fauxAssistantMessage("merged");
				},
				async (id, context) => {
					const result = lastToolResult(context);
					if (result === undefined) {
						await together();
						return fauxAssistantMessage([fauxToolCall("read", { path: files[id] })], { stopReason: "toolUse" });
					}
					return fauxAssistantMessage(`${id} saw ${result.trim()}`);
				},
			),
		);

		await harness.session.prompt("Read a.txt, b.txt and c.txt in three branches.");

		const [spawned] = toolResults(harness, "spawn_branches");
		expect(spawned).toBe(
			[
				"b1: read a.txt\nb1 saw alpha note",
				"b2: read b.txt\nb2 saw beta note",
				"b3: read c.txt\nb3 saw gamma note",
			].join("\n\n"),
		);
		expect(toolResults(harness, "gather")).toEqual([
			"b3: read c.txt\nb3 saw gamma note\n\nb1: read a.txt\nb1 saw alpha note",
		]);
		expect(harness.getPendingResponseCount()).toBe(0);
		const entries = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === "trek:branch");
		expect(entries).toHaveLength(3);
		expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
	});

	it("blocks a second branch that writes a claimed file", async () => {
		const harness = await branchHarness();
		const together = barrier(2);
		let parentStep = 0;
		harness.setResponses(
			script(
				6,
				() => {
					parentStep += 1;
					if (parentStep > 1) return fauxAssistantMessage("done");
					return fauxAssistantMessage(
						[
							fauxToolCall("spawn_branches", {
								subtasks: [{ description: "write shared.txt one" }, { description: "write shared.txt two" }],
							}),
						],
						{ stopReason: "toolUse" },
					);
				},
				async (id, context) => {
					const result = lastToolResult(context);
					if (result === undefined) {
						await together();
						return fauxAssistantMessage([fauxToolCall("write", { path: "shared.txt", content: `${id}\n` })], {
							stopReason: "toolUse",
						});
					}
					return fauxAssistantMessage(`${id}: ${result.trim()}`);
				},
			),
		);

		await harness.session.prompt("Write shared.txt in two branches.");

		const [spawned] = toolResults(harness, "spawn_branches");
		const claimed = spawned.match(/branch (b\d): shared\.txt is claimed by branch (b\d)/g) ?? [];
		expect(claimed).toHaveLength(1);
		const owner = /is claimed by branch (b\d)/.exec(spawned)?.[1];
		expect(readFileSync(join(harness.tempDir, "shared.txt"), "utf-8")).toBe(`${owner}\n`);
	});

	it("refuses five branches", async () => {
		const harness = await branchHarness();
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("spawn_branches", {
						subtasks: Array.from({ length: 5 }, (_, i) => ({ description: `read ${i}` })),
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("too many"),
		]);

		await harness.session.prompt("Split this into five branches.");

		const result = harness.session.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "spawn_branches",
		);
		expect(result?.role).toBe("toolResult");
		if (result?.role !== "toolResult") return;
		expect(result.isError).toBe(true);
		expect(textOf(result.content)).toBe("Branch breadth limit (4) exceeded: 5 subtasks.");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("HALT in one branch stops writes in every branch", async () => {
		const harness = await branchHarness();
		const together = barrier(2);
		let parentStep = 0;
		harness.setResponses(
			script(
				6,
				() => {
					parentStep += 1;
					if (parentStep > 1) return fauxAssistantMessage("halted");
					return fauxAssistantMessage(
						[
							fauxToolCall("spawn_branches", {
								subtasks: [{ description: "write one.txt" }, { description: "write two.txt" }],
							}),
						],
						{ stopReason: "toolUse" },
					);
				},
				async (id, context) => {
					const result = lastToolResult(context);
					if (result === undefined) {
						await together();
						harness.session.requestHalt();
						const name = id === "b1" ? "one.txt" : "two.txt";
						return fauxAssistantMessage([fauxToolCall("write", { path: name, content: "x\n" })], {
							stopReason: "toolUse",
						});
					}
					return fauxAssistantMessage(`${id}: ${result.trim()}`);
				},
			),
		);

		await harness.session.prompt("Write one.txt and two.txt in two branches.");

		expect(existsSync(join(harness.tempDir, "one.txt"))).toBe(false);
		expect(existsSync(join(harness.tempDir, "two.txt"))).toBe(false);
		expect(harness.session.isHalted()).toBe(true);
		harness.session.clearHalt();
	});

	it("supervised asks once per branch call, one dialog at a time", async () => {
		const harness = await branchHarness();
		harness.session.setOperatorMode("supervised");
		const asked: string[] = [];
		let open = 0;
		let overlap = false;
		harness.session.setToolConfirmHandler(async (toolName, detail) => {
			open += 1;
			if (open > 1) overlap = true;
			asked.push(`${toolName} ${detail}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
			open -= 1;
			return true;
		});
		const together = barrier(2);
		let parentStep = 0;
		harness.setResponses(
			script(
				6,
				() => {
					parentStep += 1;
					if (parentStep > 1) return fauxAssistantMessage("done");
					return fauxAssistantMessage(
						[
							fauxToolCall("spawn_branches", {
								subtasks: [{ description: "echo one" }, { description: "echo two" }],
							}),
						],
						{ stopReason: "toolUse" },
					);
				},
				async (id, context) => {
					const result = lastToolResult(context);
					if (result === undefined) {
						await together();
						return fauxAssistantMessage([fauxToolCall("bash", { command: `echo ${id}` })], {
							stopReason: "toolUse",
						});
					}
					return fauxAssistantMessage(`${id}: ${result.trim()}`);
				},
			),
		);

		await harness.session.prompt("Echo in two branches.");

		expect(asked.sort()).toEqual(["bash echo b1", "bash echo b2"]);
		expect(overlap).toBe(false);
		const [spawned] = toolResults(harness, "spawn_branches");
		expect(spawned).toContain("b1: b1");
		expect(spawned).toContain("b2: b2");
	});

	it("diagnostic mode blocks a write inside a branch", async () => {
		const harness = await branchHarness();
		harness.session.setDiagnostic(true);
		let parentStep = 0;
		harness.setResponses(
			script(
				4,
				() => {
					parentStep += 1;
					if (parentStep > 1) return fauxAssistantMessage("done");
					return fauxAssistantMessage(
						[fauxToolCall("spawn_branches", { subtasks: [{ description: "write fresh.ts" }] })],
						{ stopReason: "toolUse" },
					);
				},
				(id, context) => {
					const result = lastToolResult(context);
					if (result === undefined) {
						return fauxAssistantMessage([fauxToolCall("write", { path: "fresh.ts", content: "x\n" })], {
							stopReason: "toolUse",
						});
					}
					return fauxAssistantMessage(`${id}: ${result.trim()}`);
				},
			),
		);

		await harness.session.prompt("Write fresh.ts in a branch.");

		expect(existsSync(join(harness.tempDir, "fresh.ts"))).toBe(false);
		expect(toolResults(harness, "spawn_branches")[0]).toContain(
			"Diagnostic mode: write is blocked (mutating tools are not allowed).",
		);
	});
});
