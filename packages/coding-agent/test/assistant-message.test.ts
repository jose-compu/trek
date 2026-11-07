import type { AssistantMessage } from "@trek/ai";
import { describe, expect, test } from "vitest";
import {
	AssistantMessageComponent,
	shouldRenderAssistantTextBlock,
} from "../src/modes/interactive/components/assistant-message.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent", () => {
	test("adds OSC 133 zone markers to assistant messages without tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: "hello" }]));
		const lines = component.render(40);

		expect(lines).not.toHaveLength(0);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[lines.length - 1].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	test("does not add OSC 133 zone markers when assistant message contains tool calls", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "calling tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file.txt" } },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.includes(OSC133_ZONE_START)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_END)).toBe(false);
		expect(rendered.includes(OSC133_ZONE_FINAL)).toBe(false);
	});

	test("drops prefix duplicate text blocks from streaming artifacts", () => {
		initTheme("dark");

		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{ type: "text", text: "Hello. How" },
				{ type: "text", text: "Hello. How can I help?" },
			]),
		);
		const rendered = component.render(60).join("\n");

		expect(rendered.match(/Hello\. How/g)?.length).toBe(1);
		expect(rendered).toContain("Hello. How can I help?");
	});

	test("shouldRenderAssistantTextBlock keeps unrelated text blocks", () => {
		const blocks = ["First answer.", "Second answer."];
		expect(shouldRenderAssistantTextBlock("First answer.", blocks)).toBe(true);
		expect(shouldRenderAssistantTextBlock("Second answer.", blocks)).toBe(true);
	});

	test("compact thinking is a header plus the last 3 lines", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "one\ntwo\nthree\nfour\nfive" }]),
			false,
			getMarkdownTheme(),
			"Thinking...",
			false,
		);
		const lines = component
			.render(80)
			.map((line) =>
				line
					.replace(/\x1b\[[0-9;]*m/g, "")
					.replace(/\x1b\]133;[ABC]\x07/g, "")
					.trim(),
			)
			.filter(Boolean);
		expect(lines[0]).toContain("thinking");
		expect(lines).toEqual(expect.arrayContaining(["three", "four", "five"]));
		expect(lines).not.toContain("one");
		expect(lines.length).toBeLessThanOrEqual(4);

		component.setExpanded(true);
		const expanded = component.render(80).join("\n");
		expect(expanded).toContain("one");
		expect(expanded).toContain("five");
	});

	test("thinking briefly uses a compact title and a 1–2 line viewport", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: "one\ntwo\nthree\nfour" }]),
			false,
			getMarkdownTheme(),
			"Thinking...",
			false,
			true,
		);
		const lines = component
			.render(80)
			.map((line) =>
				line
					.replace(/\x1b\[[0-9;]*m/g, "")
					.replace(/\x1b\]133;[ABC]\x07/g, "")
					.trim(),
			)
			.filter(Boolean);
		expect(lines[0]).toContain("thinking briefly");
		expect(lines).not.toContain("one");
		expect(lines).not.toContain("two");
		expect(lines.length).toBeLessThanOrEqual(3);
	});

	test("compact thinking is 3 wrapped visual lines, not 3 source paragraphs", () => {
		initTheme("dark");
		const paragraph =
			"The French build script will be reused as a base, with design and fonts rewritten for Argentina. " +
			"A switcher will be added to both papers. The directory structure will place Argentina under gazettes. " +
			"Rebuilding France would refetch news, so the generated index will be patched instead.";
		const compact = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: paragraph }]),
			false,
			getMarkdownTheme(),
			"Thinking...",
			false,
		);
		const expanded = new AssistantMessageComponent(
			createAssistantMessage([{ type: "thinking", thinking: paragraph }]),
			false,
			getMarkdownTheme(),
			"Thinking...",
			true,
		);
		const compactLines = compact
			.render(48)
			.map((line) =>
				line
					.replace(/\x1b\[[0-9;]*m/g, "")
					.replace(/\x1b\]133;[ABC]\x07/g, "")
					.trim(),
			)
			.filter(Boolean);
		expect(compactLines[0]).toContain("thinking");
		expect(compactLines.length).toBeLessThanOrEqual(4);
		expect(expanded.render(48).filter((line) => line.trim()).length).toBeGreaterThan(compactLines.length);
		expect(expanded.render(48).join("\n")).toContain("French build script");
	});
});
