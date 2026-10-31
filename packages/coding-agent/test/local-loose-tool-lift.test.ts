/**
 * Security and false-positive checks for implicit LFM tool JSON lifting.
 * Run: npx vitest run test/local-loose-tool-lift.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { liftLocalToolText } from "../src/core/runtime/local-work.ts";

const allowed = ["read", "write", "edit", "bash"] as const;

function lift(text: string, tools: Iterable<string> = allowed) {
	return liftLocalToolText({ stopReason: "stop", content: [{ type: "text", text }] }, tools);
}

describe("liftLocalToolText security", () => {
	it("accepts allowlisted tools with sanitized arguments", () => {
		const lifted = lift('{"name":"write","arguments":{"path":"a.html","content":"ok"}}');
		expect(lifted.stopReason).toBe("toolUse");
		expect(lifted.content[0]).toMatchObject({
			type: "toolCall",
			name: "write",
			arguments: { path: "a.html", content: "ok" },
		});
	});

	it("rejects unknown tool names", () => {
		const exec = lift('{"name":"eval","arguments":{"code":"1+1"}}');
		expect(exec.stopReason).toBe("stop");
		expect(exec.content.every((p) => p.type !== "toolCall")).toBe(true);

		const narrowed = lift('{"name":"write","arguments":{"path":"x","content":"y"}}', ["read"]);
		expect(narrowed.stopReason).toBe("stop");
	});

	it("rejects unsafe tool identifiers", () => {
		for (const text of [
			'{"name":"__proto__","arguments":{"path":"x","content":"y"}}',
			'{"name":"constructor","arguments":{"command":"id"}}',
			'{"name":"../bash","arguments":{"command":"id"}}',
			'{"name":"bash;rm","arguments":{"command":"id"}}',
		]) {
			expect(lift(text).stopReason).toBe("stop");
		}
	});

	it("strips dangerous and unknown argument keys", () => {
		const proto = lift(
			'{"name":"write","arguments":{"path":"f.txt","content":"x","__proto__":{"polluted":true},"extra":"nope"}}',
		);
		expect(proto.stopReason).toBe("toolUse");
		const args = (proto.content[0] as { arguments?: Record<string, unknown> }).arguments!;
		expect(args).toEqual({ path: "f.txt", content: "x" });
		expect(Object.hasOwn(args, "__proto__")).toBe(false);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();

		const nested = lift('{"name":"read","arguments":{"path":"a","constructor":{"name":"Error"},"prototype":1}}');
		expect((nested.content[0] as { arguments?: unknown }).arguments).toEqual({ path: "a" });
	});

	it("rejects partial tool arrays", () => {
		const partial = lift(
			'[{"name":"write","arguments":{"path":"a","content":"b"}},{"name":"evil","arguments":{"command":"rm -rf /"}}]',
		);
		expect(partial.stopReason).toBe("stop");

		const badArg = lift('[{"name":"write","arguments":{"path":"a","content":"b"}},{"name":"bash","arguments":{}}]');
		expect(badArg.stopReason).toBe("stop");
	});

	it("caps lifted calls from arrays", () => {
		const many = lift(
			JSON.stringify([
				{ name: "write", arguments: { path: "1", content: "a" } },
				{ name: "write", arguments: { path: "2", content: "b" } },
				{ name: "write", arguments: { path: "3", content: "c" } },
				{ name: "write", arguments: { path: "4", content: "d" } },
				{ name: "write", arguments: { path: "5", content: "e" } },
			]),
		);
		expect(many.stopReason).toBe("stop");
	});

	it("ignores prose that is not a full tool shape", () => {
		expect(lift('Tutorial: {"name": "write"} only.').stopReason).toBe("stop");
		expect(lift('{"notName":"write","arguments":{"path":"x"}}').stopReason).toBe("stop");
	});

	it("rejects null bytes and oversize strings", () => {
		const nul = lift(`{"name":"write","arguments":{"path":"a\\u0000b","content":"x"}}`);
		expect(nul.stopReason).toBe("stop");
		const huge = lift(`{"name":"write","arguments":{"path":"a.html","content":"${"x".repeat(512_001)}"}}`);
		expect(huge.stopReason).toBe("stop");
	});
});
