/**
 * Archon include, with, inputs, returns (0.20-F issue #242).
 * Run: npx vitest run test/archon-include.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { expandIncludes, parseArchonWorkflow } from "../src/core/domains/archon.ts";

describe("Archon include, with, inputs, returns", () => {
	it("parses an include node with workflow name", () => {
		const workflow = parseArchonWorkflow(`
name: open-pr
description: Open a pull request with commits.
nodes:
  - id: commit
    include: commit-on-branch
`);
		expect(workflow.nodes).toHaveLength(1);
		expect(workflow.nodes[0]?.kind).toBe("include");
		expect(workflow.nodes[0]?.include?.workflow).toBe("commit-on-branch");
		expect(workflow.nodes[0]?.include?.namespace).toBeUndefined();
	});

	it("parses an include node with namespace", () => {
		const workflow = parseArchonWorkflow(`
name: open-pr
description: Open a pull request with commits.
nodes:
  - id: commit
    include:
      workflow: commit-on-branch
      namespace: mycommit
`);
		expect(workflow.nodes[0]?.kind).toBe("include");
		expect(workflow.nodes[0]?.include?.workflow).toBe("commit-on-branch");
		expect(workflow.nodes[0]?.include?.namespace).toBe("mycommit");
	});

	it("parses with parameters for include", () => {
		const workflow = parseArchonWorkflow(`
name: open-pr
description: Open a pull request with commits.
nodes:
  - id: commit
    include: commit-on-branch
    with:
      branch: feature-branch
      message: Initial commit
`);
		expect(workflow.nodes[0]?.with).toEqual({
			branch: "feature-branch",
			message: "Initial commit",
		});
	});

	it("parses returns to select output from included workflow", () => {
		const workflow = parseArchonWorkflow(`
name: open-pr
description: Open a pull request with commits.
nodes:
  - id: commit
    include: commit-on-branch
    returns: $commit.push.output
`);
		expect(workflow.nodes[0]?.returns).toBe("$commit.push.output");
	});

	it("parses workflow inputs declaration", () => {
		const workflow = parseArchonWorkflow(`
name: commit-on-branch
description: Commit changes on a branch.
inputs:
  - branch
  - message
nodes:
  - id: write
    prompt: Write the file using $INPUTS.message
`);
		expect(workflow.inputs).toEqual(["branch", "message"]);
		expect(workflow.nodes[0]?.body).toContain("$INPUTS.message");
	});

	it("expands include by inlining nodes with namespaced ids", () => {
		const parent = parseArchonWorkflow(`
name: open-pr
description: Open a pull request.
nodes:
  - id: draft
    prompt: Draft the PR title and body
  - id: commit
    include: commit-on-branch
    depends_on: [draft]
    with:
      message: commit msg
  - id: push
    prompt: Use $commit.output to push
    depends_on: [commit]
`);

		const child = parseArchonWorkflow(`
name: commit-on-branch
description: Commit changes.
inputs:
  - message
nodes:
  - id: stage
    prompt: Stage files
  - id: write
    prompt: Write commit using $INPUTS.message
    depends_on: [stage]
`);

		const resolver = (name: string) => {
			if (name === "commit-on-branch") return child;
			throw new Error(`unknown workflow ${name}`);
		};

		const expanded = expandIncludes(parent, resolver);

		expect(expanded.nodes.map((n) => n.id)).toEqual(["draft", "commit.stage", "commit.write", "push"]);

		const stageNode = expanded.nodes.find((n) => n.id === "commit.stage");
		expect(stageNode?.dependsOn).toEqual(["draft"]);

		const writeNode = expanded.nodes.find((n) => n.id === "commit.write");
		expect(writeNode?.dependsOn).toEqual(["draft", "commit.stage"]);
		expect(writeNode?.body).toContain("commit msg");
		expect(writeNode?.body).not.toContain("$INPUTS.message");

		const pushNode = expanded.nodes.find((n) => n.id === "push");
		expect(pushNode?.dependsOn).toEqual(["commit.write"]);
		expect(pushNode?.body).toContain("$commit.write.output");
	});

	it("uses custom namespace when specified", () => {
		const parent = parseArchonWorkflow(`
name: open-pr
description: Open a pull request.
nodes:
  - id: commit
    include:
      workflow: commit-on-branch
      namespace: mycommit
`);

		const child = parseArchonWorkflow(`
name: commit-on-branch
description: Commit changes.
nodes:
  - id: stage
    prompt: Stage files
`);

		const resolver = (name: string) => {
			if (name === "commit-on-branch") return child;
			throw new Error(`unknown workflow ${name}`);
		};

		const expanded = expandIncludes(parent, resolver);
		expect(expanded.nodes[0]?.id).toBe("mycommit.stage");
	});

	it("uses returns to select specific output node", () => {
		const parent = parseArchonWorkflow(`
name: open-pr
description: Open a pull request.
nodes:
  - id: commit
    include: commit-on-branch
    returns: $commit.stage.output
  - id: push
    prompt: Use $commit.output for pushing
    depends_on: [commit]
`);

		const child = parseArchonWorkflow(`
name: commit-on-branch
description: Commit changes.
nodes:
  - id: stage
    prompt: Stage files
  - id: write
    prompt: Write commit
    depends_on: [stage]
`);

		const resolver = (name: string) => {
			if (name === "commit-on-branch") return child;
			throw new Error(`unknown workflow ${name}`);
		};

		const expanded = expandIncludes(parent, resolver);

		const pushNode = expanded.nodes.find((n) => n.id === "push");
		expect(pushNode?.body).toContain("$commit.stage.output");
	});

	it("rejects include node with missing workflow", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    include: {}
`),
		).toThrow(/include.workflow is required/);
	});

	it("rejects with parameter that is not an object", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    include: commit-on-branch
    with: not-an-object
`),
		).toThrow(/with must be an object/);
	});

	it("rejects returns that is not a string", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
nodes:
  - id: fail
    include: commit-on-branch
    returns: 123
`),
		).toThrow(/returns must be a node path/);
	});

	it("rejects workflow inputs that is not a list", () => {
		expect(() =>
			parseArchonWorkflow(`
name: test
description: Test
inputs: not-a-list
nodes:
  - id: node
    prompt: test
`),
		).toThrow(/inputs must be a list/);
	});
});
