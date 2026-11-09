import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandDependents, planAffectedTests } from "./affected-tests.mjs";

describe("planAffectedTests", () => {
	it("skips docs-only commits", () => {
		const plan = planAffectedTests(["README.md", "packages/coding-agent/CHANGELOG.md"]);
		assert.equal(plan.kind, "skip");
	});

	it("runs the full suite for lockfile or test runner changes", () => {
		assert.equal(planAffectedTests(["package-lock.json"]).kind, "full");
		assert.equal(planAffectedTests(["test.sh"]).kind, "full");
		assert.equal(planAffectedTests([".husky/pre-commit"]).kind, "full");
		assert.equal(planAffectedTests(["scripts/check-lockfile-commit.mjs"]).kind, "full");
	});

	it("runs the planner tests when only that script changes", () => {
		const plan = planAffectedTests(["scripts/affected-tests.mjs", "scripts/affected-tests.test.mjs"]);
		assert.equal(plan.kind, "self");
	});

	it("runs only the coding-agent suite for a coding-agent source change", () => {
		const plan = planAffectedTests(["packages/coding-agent/src/core/runtime/long-task.ts"]);
		assert.equal(plan.kind, "packages");
		assert.deepEqual(
			plan.runs.map((run) => `${run.name}:${run.mode}:${run.reason}`),
			["@trek/coding-agent:all:source"],
		);
	});

	it("runs only the staged coding-agent test files", () => {
		const plan = planAffectedTests(["packages/coding-agent/test/long-task.test.ts"]);
		assert.equal(plan.kind, "packages");
		assert.deepEqual(
			plan.runs.map((run) => `${run.name}:${run.mode}:${run.files.join(",")}`),
			["@trek/coding-agent:files:test/long-task.test.ts"],
		);
	});

	it("retests reverse-deps when a workspace they import changes", () => {
		const plan = planAffectedTests(["packages/ai/src/stream.ts"]);
		assert.equal(plan.kind, "packages");
		assert.deepEqual(
			plan.runs.map((run) => `${run.name}:${run.mode}:${run.reason}`),
			["@trek/ai:all:source", "@trek/agent-core:all:dependency", "@trek/coding-agent:all:dependency"],
		);
	});

	it("runs the whole coding-agent suite when both it and a dependency change", () => {
		const plan = planAffectedTests([
			"packages/ai/src/stream.ts",
			"packages/coding-agent/src/core/runtime/long-task.ts",
		]);
		const coding = plan.runs.find((run) => run.dir === "coding-agent");
		assert.equal(coding?.mode, "all");
		assert.equal(coding?.reason, "dependency");
	});

	it("runs tui then coding-agent when tui changes", () => {
		const plan = planAffectedTests(["packages/tui/src/index.ts"]);
		assert.deepEqual(
			plan.runs.map((run) => `${run.name}:${run.mode}`),
			["@trek/tui:all", "@trek/coding-agent:all"],
		);
	});

	it("runs the package suite when vitest config changes", () => {
		const plan = planAffectedTests(["packages/coding-agent/vitest.config.ts"]);
		assert.deepEqual(
			plan.runs.map((run) => `${run.name}:${run.mode}:${run.reason}`),
			["@trek/coding-agent:all:config"],
		);
	});

	it("expands ai to agent and coding-agent", () => {
		assert.deepEqual(expandDependents(["ai"]), ["ai", "agent", "coding-agent"]);
	});
});
