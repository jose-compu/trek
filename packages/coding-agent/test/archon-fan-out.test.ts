/**
 * Archon fan_out and loop_group (0.20-F issue #243).
 * Run: npx vitest run test/archon-fan-out.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { parseArchonWorkflow } from "../src/core/domains/archon.ts";

describe("Archon fan_out and loop_group", () => {
	it("parses a fan_out node with items from another node", () => {
		const workflow = parseArchonWorkflow(`
name: open-issues
description: Open multiple issues from a list.
nodes:
  - id: draft
    prompt: Draft issues as JSON array
  - id: create
    fan_out:
      items: $draft.output
      max_parallel: 2
      join: all_done
    depends_on: [draft]
`);
		expect(workflow.nodes).toHaveLength(2);
		expect(workflow.nodes[1]?.kind).toBe("fan_out");
		expect(workflow.nodes[1]?.fanOut?.items).toBe("$draft.output");
		expect(workflow.nodes[1]?.fanOut?.maxParallel).toBe(2);
		expect(workflow.nodes[1]?.fanOut?.join).toBe("all_done");
	});

	it("parses fan_out with default max_parallel of 5", () => {
		const workflow = parseArchonWorkflow(`
name: open-issues
description: Open multiple issues.
nodes:
  - id: draft
    prompt: Draft issues
  - id: create
    fan_out:
      items: $draft.output
      join: all_success
    depends_on: [draft]
`);
		expect(workflow.nodes[1]?.fanOut?.maxParallel).toBe(5);
		expect(workflow.nodes[1]?.fanOut?.join).toBe("all_success");
	});

	it("parses fan_out with workflow reference", () => {
		const workflow = parseArchonWorkflow(`
name: open-issues
description: Open multiple issues.
nodes:
  - id: create
    fan_out:
      items: $draft.output
      workflow: create-issue
      max_parallel: 3
      join: all_done
`);
		expect(workflow.nodes[0]?.fanOut?.workflow).toBe("create-issue");
		expect(workflow.nodes[0]?.fanOut?.maxParallel).toBe(3);
	});

	it("parses a loop_group with until condition", () => {
		const workflow = parseArchonWorkflow(`
name: poll-ci
description: Poll CI status until success.
nodes:
  - id: check
    loop_group:
      until: success
      max_iterations: 10
      nodes:
        - id: status
          prompt: Check CI status
        - id: wait
          bash: sleep 30
          depends_on: [status]
`);
		expect(workflow.nodes).toHaveLength(1);
		expect(workflow.nodes[0]?.kind).toBe("loop_group");
		expect(workflow.nodes[0]?.loopGroup?.until).toBe("success");
		expect(workflow.nodes[0]?.loopGroup?.maxIterations).toBe(10);
		expect(workflow.nodes[0]?.loopGroup?.nodes).toHaveLength(2);
		expect(workflow.nodes[0]?.loopGroup?.nodes[0]?.id).toBe("status");
		expect(workflow.nodes[0]?.loopGroup?.nodes[1]?.id).toBe("wait");
		expect(workflow.nodes[0]?.loopGroup?.nodes[1]?.dependsOn).toEqual(["status"]);
	});

	it("parses a loop_group with until_bash condition", () => {
		const workflow = parseArchonWorkflow(`
name: poll-ci
description: Poll CI status until bash script succeeds.
nodes:
  - id: check
    loop_group:
      until_bash: gh run view --json conclusion | jq -r '.conclusion' | grep -q success
      max_iterations: 10
      nodes:
        - id: status
          prompt: Check CI status
`);
		expect(workflow.nodes[0]?.loopGroup?.untilBash).toBeTruthy();
		expect(workflow.nodes[0]?.loopGroup?.until).toBeUndefined();
		expect(workflow.nodes[0]?.loopGroup?.maxIterations).toBe(10);
	});

	it("rejects fan_out without items", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    fan_out:
      max_parallel: 2
      join: all_done
`),
		).toThrow(/fan_out.items is required/);
	});

	it("rejects fan_out with invalid join", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    fan_out:
      items: $node.output
      join: invalid
`),
		).toThrow(/join must be all_done or all_success/);
	});

	it("rejects loop_group without max_iterations", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    loop_group:
      until: done
      nodes:
        - id: step
          prompt: step
`),
		).toThrow(/max_iterations must be a positive integer/);
	});

	it("rejects loop_group without until or until_bash", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    loop_group:
      max_iterations: 5
      nodes:
        - id: step
          prompt: step
`),
		).toThrow(/requires either until or until_bash/);
	});

	it("rejects loop_group without nodes", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    loop_group:
      until: done
      max_iterations: 5
      nodes: []
`),
		).toThrow(/loop_group.nodes is required/);
	});

	it("parses include node inside loop_group", () => {
		const workflow = parseArchonWorkflow(`
name: batch-process
description: Loop with included workflow.
nodes:
  - id: process
    loop_group:
      until: done
      max_iterations: 5
      nodes:
        - id: step
          include: subprocess
          with:
            param: value
`);
		expect(workflow.nodes[0]?.loopGroup?.nodes).toHaveLength(1);
		expect(workflow.nodes[0]?.loopGroup?.nodes[0]?.kind).toBe("include");
		expect(workflow.nodes[0]?.loopGroup?.nodes[0]?.include?.workflow).toBe("subprocess");
		expect(workflow.nodes[0]?.loopGroup?.nodes[0]?.with).toEqual({ param: "value" });
	});

	it("parses fan_out with include workflow reference", () => {
		const workflow = parseArchonWorkflow(`
name: parallel-includes
description: Fan out over includes.
nodes:
  - id: items
    prompt: Generate items
  - id: process
    fan_out:
      items: $items.output
      workflow: process-item
      max_parallel: 3
      join: all_success
    depends_on: [items]
`);
		expect(workflow.nodes[1]?.fanOut?.workflow).toBe("process-item");
		expect(workflow.nodes[1]?.fanOut?.items).toBe("$items.output");
	});
});
