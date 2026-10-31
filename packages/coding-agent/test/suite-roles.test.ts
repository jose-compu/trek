/**
 * Every local suite: Workhorse acts, Planning thinks, Frontier is API deep work.
 * Run: npx vitest run test/suite-roles.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { defaultRuntimeConfig, resolveRuntime, withHierarchy } from "../src/core/runtime/index.ts";
import { liftLocalToolText } from "../src/core/runtime/local-work.ts";
import { selectSessionRole, selectThinkRole, sessionRoleForModel } from "../src/core/runtime/select-role.ts";
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
		it(`${suite}: a build thinks on Planning and acts on the workhorse`, () => {
			const runtime = resolved(suite);
			const planning = runtime.roles.planning;
			const workhorse = runtime.roles.workhorse;
			expect(planning?.id).toBeTruthy();
			expect(workhorse?.id).toBeTruthy();
			expect(runtime.roles.tooling).toBeUndefined();
			expect(planning?.id).not.toBe(workhorse?.id);

			for (const text of [
				"build a web chess in javascript in /tmp/chess",
				"make a web chess in javascript",
				"write a chess game",
				"implement the login page",
			]) {
				const act = selectSessionRole({ text, resolved: runtime });
				const think = selectThinkRole({ text, resolved: runtime });
				expect(act.role, text).toBe("workhorse");
				expect(act.modelId, text).toBe(workhorse?.id);
				expect(think?.role, text).toBe("planning");
				expect(think?.modelId, text).toBe(planning?.id);
			}

			const typo = selectSessionRole({ text: "fix the typo in the title", resolved: runtime });
			expect(typo.role).toBe("workhorse");
			expect(typo.modelId).toBe(workhorse?.id);
			expect(selectThinkRole({ text: "fix the typo in the title", resolved: runtime })).toBeUndefined();

			const follow = selectSessionRole({
				text: "add castling",
				resolved: runtime,
				previousRole: "planning",
			});
			expect(follow.role).toBe("workhorse");
			expect(selectThinkRole({ text: "add castling", resolved: runtime, previousRole: "planning" })?.role).toBe(
				"planning",
			);

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
