/**
 * Archon wait, cancel, on_timeout, retry, denied_tools, if_skipped (0.20-F issue #244).
 * Run: npx vitest run test/archon-control-flow.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { parseArchonWorkflow } from "../src/core/domains/archon.ts";
import { normalizeTriggerRule, shouldRunByTrigger } from "../src/core/domains/archon-when.ts";

describe("Archon control flow features", () => {
	it("parses wait with attention type", () => {
		const workflow = parseArchonWorkflow(`
name: approval
description: Wait for human approval.
nodes:
  - id: ask
    prompt: Draft the request
  - id: approve
    wait: attention
    prompt: Wait for approval
    depends_on: [ask]
`);
		expect(workflow.nodes[1]?.wait?.type).toBe("attention");
		expect(workflow.nodes[1]?.wait?.durationMs).toBeUndefined();
	});

	it("parses wait with duration in ms", () => {
		const workflow = parseArchonWorkflow(`
name: poll
description: Poll with delay.
nodes:
  - id: check
    prompt: Check status
  - id: wait
    wait: 5000
    bash: sleep 5
    depends_on: [check]
`);
		expect(workflow.nodes[1]?.wait?.type).toBe("duration");
		expect(workflow.nodes[1]?.wait?.durationMs).toBe(5000);
	});

	it("parses wait with object syntax", () => {
		const workflow = parseArchonWorkflow(`
name: poll
description: Poll with delay.
nodes:
  - id: wait
    wait:
      type: duration
      duration_ms: 10000
    bash: sleep 10
`);
		expect(workflow.nodes[0]?.wait?.type).toBe("duration");
		expect(workflow.nodes[0]?.wait?.durationMs).toBe(10000);
	});

	it("parses cancel flag", () => {
		const workflow = parseArchonWorkflow(`
name: ci-check
description: Cancel workflow on failure.
nodes:
  - id: test
    prompt: Run tests
  - id: stop
    cancel: true
    prompt: Stop the workflow
    depends_on: [test]
`);
		expect(workflow.nodes[1]?.cancel).toBe(true);
	});

	it("parses on_timeout with skip action", () => {
		const workflow = parseArchonWorkflow(`
name: ci-check
description: Skip on timeout.
nodes:
  - id: slow
    bash: sleep 100
    timeout: 1000
    on_timeout: skip
`);
		expect(workflow.nodes[0]?.onTimeout).toBe("skip");
		expect(workflow.nodes[0]?.timeout).toBe(1000);
	});

	it("parses retry with max_attempts", () => {
		const workflow = parseArchonWorkflow(`
name: api-call
description: Retry on failure.
nodes:
  - id: call
    prompt: Call the API
    retry: 3
`);
		expect(workflow.nodes[0]?.retry?.maxAttempts).toBe(3);
	});

	it("parses retry with object syntax", () => {
		const workflow = parseArchonWorkflow(`
name: api-call
description: Retry on failure.
nodes:
  - id: call
    prompt: Call the API
    retry:
      max_attempts: 5
`);
		expect(workflow.nodes[0]?.retry?.maxAttempts).toBe(5);
	});

	it("parses denied_tools list", () => {
		const workflow = parseArchonWorkflow(`
name: restricted
description: Deny specific tools.
nodes:
  - id: safe
    prompt: Do not mutate the repo
    denied_tools: [gh pr merge, git push]
`);
		expect(workflow.nodes[0]?.deniedTools).toEqual(["gh pr merge", "git push"]);
	});

	it("parses if_skipped condition", () => {
		const workflow = parseArchonWorkflow(`
name: conditional
description: Run only if dependency was skipped.
nodes:
  - id: optional
    when: "$USER_MESSAGE contains 'skip'"
    prompt: Optional step
  - id: fallback
    if_skipped: "$optional.output == '(skipped)'"
    prompt: Run when optional is skipped
    depends_on: [optional]
`);
		expect(workflow.nodes[1]?.ifSkipped).toBe("$optional.output == '(skipped)'");
	});

	it("parses mutates_checkout flag", () => {
		const workflow = parseArchonWorkflow(`
name: read-only
description: Parallel safe operation.
nodes:
  - id: read
    bash: cat file.txt
    mutates_checkout: false
`);
		expect(workflow.nodes[0]?.mutatesCheckout).toBe(false);
	});

	it("parses one_success as trigger_rule alias", () => {
		const workflow = parseArchonWorkflow(`
name: any-dep
description: Run if any dependency succeeds.
nodes:
  - id: a
    prompt: Step A
  - id: b
    prompt: Step B
  - id: either
    trigger_rule: one_success
    prompt: Run if A or B succeeds
    depends_on: [a, b]
`);
		expect(workflow.nodes[2]?.triggerRule).toBe("one_success");
		expect(normalizeTriggerRule("one_success")).toBe("any_success");
	});

	it("normalizes one_success to any_success in trigger logic", () => {
		const statuses = new Map([
			["a", "ok" as const],
			["b", "failed" as const],
		]);
		expect(shouldRunByTrigger("one_success", ["a", "b"], statuses)).toBe(true);
		expect(shouldRunByTrigger("any_success", ["a", "b"], statuses)).toBe(true);
	});

	it("rejects wait with invalid value", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    wait: invalid
    prompt: test
`),
		).toThrow(/wait must be 'attention', a duration in ms, or/);
	});

	it("rejects cancel with non-boolean value", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    cancel: not-a-bool
    prompt: test
`),
		).toThrow(/cancel must be a boolean/);
	});

	it("rejects on_timeout on non-bash node", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    on_timeout: skip
    prompt: test
`),
		).toThrow(/on_timeout is only valid on bash or script nodes/);
	});

	it("rejects on_timeout with invalid action", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    bash: sleep 1
    on_timeout: invalid
`),
		).toThrow(/on_timeout must be skip or fail/);
	});

	it("rejects retry with invalid value", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    retry: not-a-number
    prompt: test
`),
		).toThrow(/retry must be a positive integer or/);
	});

	it("rejects denied_tools with non-array", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    denied_tools: not-an-array
    prompt: test
`),
		).toThrow(/denied_tools must be a list of tool names/);
	});

	it("rejects mutates_checkout with non-boolean", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    mutates_checkout: not-a-bool
    bash: echo test
`),
		).toThrow(/mutates_checkout must be a boolean/);
	});

	it("parses control flow features inside included workflow", () => {
		const workflow = parseArchonWorkflow(`
name: subprocess
description: Subprocess with control flow.
inputs:
  - timeout_value
nodes:
  - id: step
    bash: echo $INPUTS.timeout_value
    timeout: 5000
    on_timeout: skip
    retry: 3
    mutates_checkout: false
    denied_tools: [gh pr merge]
`);
		expect(workflow.inputs).toEqual(["timeout_value"]);
		expect(workflow.nodes[0]?.timeout).toBe(5000);
		expect(workflow.nodes[0]?.onTimeout).toBe("skip");
		expect(workflow.nodes[0]?.retry?.maxAttempts).toBe(3);
		expect(workflow.nodes[0]?.mutatesCheckout).toBe(false);
		expect(workflow.nodes[0]?.deniedTools).toEqual(["gh pr merge"]);
	});

	it("parses control flow features inside loop_group", () => {
		const workflow = parseArchonWorkflow(`
name: poll-with-retry
description: Loop with retry and timeout.
nodes:
  - id: poll
    loop_group:
      until: success
      max_iterations: 10
      nodes:
        - id: check
          prompt: Check status
          retry: 3
          wait: 1000
        - id: verify
          bash: test -f status.txt
          timeout: 2000
          on_timeout: skip
          depends_on: [check]
`);
		const loopNodes = workflow.nodes[0]?.loopGroup?.nodes;
		expect(loopNodes).toHaveLength(2);
		expect(loopNodes?.[0]?.retry?.maxAttempts).toBe(3);
		expect(loopNodes?.[0]?.wait?.durationMs).toBe(1000);
		expect(loopNodes?.[1]?.timeout).toBe(2000);
		expect(loopNodes?.[1]?.onTimeout).toBe("skip");
	});

	it("parses if_skipped with when condition and trigger_rule", () => {
		const workflow = parseArchonWorkflow(`
name: conditional-skip
description: Handle skipped dependencies.
nodes:
  - id: optional
    when: "$USER_MESSAGE contains 'run'"
    prompt: Optional step
  - id: fallback
    trigger_rule: one_success
    if_skipped: "$optional.output == '(skipped)'"
    prompt: Run when optional is skipped
    depends_on: [optional]
`);
		expect(workflow.nodes[1]?.triggerRule).toBe("one_success");
		expect(workflow.nodes[1]?.ifSkipped).toBe("$optional.output == '(skipped)'");
	});

	it("parses fan_out with workflow that has control flow features", () => {
		const workflow = parseArchonWorkflow(`
name: parallel-with-retry
description: Fan out with retry.
nodes:
  - id: items
    prompt: Generate items
  - id: process
    fan_out:
      items: $items.output
      workflow: retry-process
      max_parallel: 3
      join: all_success
    depends_on: [items]
`);
		expect(workflow.nodes[1]?.fanOut?.workflow).toBe("retry-process");
	});
});
