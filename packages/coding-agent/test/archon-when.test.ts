/**
 * Archon when: / trigger_rule / loop.
 * Run: npx vitest run test/archon-when.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { parseArchonWorkflow } from "../src/core/domains/archon.ts";
import { evaluateWhen, shouldRunByTrigger } from "../src/core/domains/archon-when.ts";
import { runArchonWorkflow } from "../src/core/domains/run.ts";

describe("Archon when and trigger_rule", () => {
	it("evaluates contains, equality, and || / &&", () => {
		const outputs = new Map([["classify", '{"target":"workhorse"}']]);
		expect(evaluateWhen("$classify.output contains 'workhorse'", { userMessage: "", outputs })).toBe(true);
		expect(evaluateWhen("$classify.output.target == 'workhorse'", { userMessage: "", outputs })).toBe(true);
		expect(evaluateWhen("$USER_MESSAGE contains 'fetch'", { userMessage: "Fetch a URL", outputs })).toBe(true);
		expect(
			evaluateWhen("$classify.output contains 'script' || $classify.output contains 'workhorse'", {
				userMessage: "",
				outputs,
			}),
		).toBe(true);
		expect(evaluateWhen("$classify.output contains 'script'", { userMessage: "", outputs })).toBe(false);
	});

	it("joins trigger_rule all_success vs all_done", () => {
		const statuses = new Map([
			["a", "ok" as const],
			["b", "skipped" as const],
		]);
		expect(shouldRunByTrigger("all_success", ["a", "b"], statuses)).toBe(false);
		expect(shouldRunByTrigger("all_done", ["a", "b"], statuses)).toBe(true);
		expect(shouldRunByTrigger("any_success", ["a", "b"], statuses)).toBe(true);
	});

	it("skips a when: false branch and keeps the matching route", async () => {
		const workflow = parseArchonWorkflow(`
name: layer-route
description: Branch on classify.
nodes:
  - id: classify
    prompt: classify
  - id: script
    when: "$classify.output contains 'script'"
    prompt: scripts
    depends_on: [classify]
  - id: workhorse
    when: "$classify.output contains 'workhorse'"
    prompt: workhorse
    depends_on: [classify]
`);
		const results = await runArchonWorkflow(workflow, {
			cwd: process.cwd(),
			userMessage: "fix the lint",
			runPrompt: async (_prompt, node) => (node.id === "classify" ? '{"target":"workhorse"}' : node.id),
		});
		expect(results).toEqual([
			{ id: "classify", output: '{"target":"workhorse"}' },
			{ id: "script", output: "(skipped)" },
			{ id: "workhorse", output: "workhorse" },
		]);
	});

	it("runs a loop until the until token", async () => {
		const workflow = parseArchonWorkflow(`
name: verify
description: Loop until LGTM.
nodes:
  - id: verdict
    loop:
      prompt: review
      until: LGTM
      max_iterations: 4
`);
		const calls: string[] = [];
		const results = await runArchonWorkflow(workflow, {
			cwd: process.cwd(),
			runPrompt: async () => {
				calls.push("tick");
				return calls.length < 2 ? "needs work" : "LGTM";
			},
		});
		expect(calls).toHaveLength(2);
		expect(results[0]?.output).toBe("LGTM");
	});

	it("parses effort, context, output_format, and allowed_tools on layer-escalate", () => {
		const workflow = parseArchonWorkflow(
			`name: x
description: d
nodes:
  - id: brief
    role: workhorse
    effort: low
    allowed_tools: []
    output_type: findings
    output_format: { type: object }
    prompt: hi
  - id: plan
    role: planning
    effort: high
    context: fresh
    trigger_rule: all_success
    prompt: plan
    depends_on: [brief]
`,
		);
		expect(workflow.nodes[0]?.effort).toBe("low");
		expect(workflow.nodes[0]?.outputType).toBe("findings");
		expect(workflow.nodes[0]?.outputFormat).toEqual({ type: "object" });
		expect(workflow.nodes[1]?.context).toBe("fresh");
		expect(workflow.nodes[1]?.triggerRule).toBe("all_success");
	});
});
