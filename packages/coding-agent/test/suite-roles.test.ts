/**
 * Every local suite: hard work uses Planning, a typo uses the workhorse.
 * The tooling model is never the session model.
 * Run: npx vitest run test/suite-roles.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { defaultRuntimeConfig, resolveRuntime, withHierarchy } from "../src/core/runtime/index.ts";
import { liftLocalToolText } from "../src/core/runtime/local-work.ts";
import { selectSessionRole, sessionRoleForModel } from "../src/core/runtime/select-role.ts";
import type { SuiteId } from "../src/core/runtime/types.ts";

const SUITES: SuiteId[] = ["mistral", "mistral-pro", "qwen", "lfm"];

function resolved(suite: SuiteId) {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite }), { frontier: null });
}

describe("local suite roles", () => {
	it("turns a JSON tool call in the reply text into a tool call", () => {
		const lifted = liftLocalToolText({
			stopReason: "stop",
			content: [
				{
					type: "text",
					text: '{"name": "write", "arguments": {"path": "/tmp/chess/index.html", "content": "Chess"}}',
				},
			],
		});
		expect(lifted.stopReason).toBe("toolUse");
		expect(lifted.content).toEqual([
			{
				type: "toolCall",
				id: "local-tool-1",
				name: "write",
				arguments: { path: "/tmp/chess/index.html", content: "Chess" },
			},
		]);
		const trailed = liftLocalToolText({
			stopReason: "stop",
			content: [
				{
					type: "text",
					text: '{"name": "write", "arguments": {"path": "/tmp/chess/index.html", "content": "Chess"}}\n\nThe user wants a title.',
				},
			],
		});
		expect(trailed.content[0]).toMatchObject({ type: "toolCall", name: "write" });
		const narrated = liftLocalToolText({
			stopReason: "stop",
			content: [
				{
					type: "text",
					text: [
						"That would be the content. We need to write this to index.html.",
						"Thus final answer:",
						"[",
						'  {"name": "write", "arguments": {"path": "index.html", "content": "<title>Calculator</title>\\n<button>1</button>"}},',
						'  {"name": "bash", "arguments": {"command": "ls -l index.html"}}',
						"]",
					].join("\n"),
				},
			],
		});
		expect(narrated.stopReason).toBe("toolUse");
		expect(narrated.content.map((part) => (part as { name?: string }).name)).toEqual(["write", "bash"]);
		expect((narrated.content[0] as { arguments?: unknown }).arguments).toMatchObject({ path: "index.html" });
		expect((narrated.content[1] as { arguments?: unknown }).arguments).toMatchObject({ command: "ls -l index.html" });
		const prose = liftLocalToolText({
			stopReason: "stop",
			content: [{ type: "text", text: 'Here is an example {"name": "write"} inside a tutorial.' }],
		});
		expect(prose.stopReason).toBe("stop");
	});

	for (const suite of SUITES) {
		it(`${suite}: a build and a follow-up use Planning, a typo uses the workhorse`, () => {
			const runtime = resolved(suite);
			const planning = runtime.roles.planning;
			const workhorse = runtime.roles.workhorse;
			const tooling = runtime.roles.tooling;
			expect(planning?.id).toBeTruthy();
			expect(workhorse?.id).toBeTruthy();
			expect(tooling?.id).toBeTruthy();
			expect(planning?.id).not.toBe(tooling?.id);
			expect(workhorse?.id).not.toBe(tooling?.id);

			for (const text of [
				"build a web chess in javascript in /tmp/chess",
				"make a web chess in javascript",
				"write a chess game",
				"implement the login page",
			]) {
				const selected = selectSessionRole({ text, resolved: runtime });
				expect(selected.role, text).toBe("planning");
				expect(selected.modelId, text).toBe(planning?.id);
				expect(selected.modelId, text).not.toBe(tooling?.id);
			}

			const typo = selectSessionRole({ text: "fix the typo in the title", resolved: runtime });
			expect(typo.role).toBe("workhorse");
			expect(typo.modelId).toBe(workhorse?.id);

			const follow = selectSessionRole({
				text: "add castling",
				resolved: runtime,
				previousRole: "planning",
			});
			expect(follow.role).toBe("planning");
			expect(follow.modelId).toBe(planning?.id);
			expect(follow.reason).toMatch(/continuing a Planning task/);

			const drop = selectSessionRole({
				text: "fix the typo",
				resolved: runtime,
				previousRole: "planning",
			});
			expect(drop.role).toBe("workhorse");
			expect(drop.modelId).toBe(workhorse?.id);

			expect(selectSessionRole({ text: "", resolved: runtime }).role).toBe("workhorse");
			expect(sessionRoleForModel(runtime, { provider: "local", name: planning?.id, id: planning?.id })).toBe(
				"planning",
			);
		});
	}
});
