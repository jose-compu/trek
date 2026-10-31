import { describe, expect, test } from "vitest";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const BG_RESET = "\x1b[49m";

describe("UserMessageComponent", () => {
	test("keeps user message height stable while moving closing OSC markers off line end", () => {
		initTheme("dark");

		const component = new UserMessageComponent("hello");
		const lines = component.render(20);

		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[0].endsWith(BG_RESET)).toBe(true);
		expect(lines[0]).not.toContain(OSC133_ZONE_END);
		expect(lines[1]).toContain("hello");
		expect(lines[2].startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
		expect(lines[2].endsWith(BG_RESET)).toBe(true);
	});

	test("paints an Archon node card in three shades on one grey background", () => {
		initTheme("dark");
		const component = new UserMessageComponent(
			[
				"Answer only this Archon node.",
				"One line. No preamble.",
				"",
				"User turn:",
				"Close the unused admin port.",
				"",
				"Known facts:",
				"reconciliation break: the west cistern",
				"",
				"Node quantify-break:",
				"Separate what is known from what is estimated.",
				"",
				"$name-account.output:",
				"account period amount not in the turn",
			].join("\n"),
		);
		const rendered = component.render(80).join("\n");
		expect(rendered).toContain(theme.fg("dim", "Answer only this Archon node."));
		expect(rendered).toContain(theme.fg("dim", "One line. No preamble."));
		expect(rendered).toContain(theme.fg("accent", "User turn:"));
		expect(rendered).toContain(theme.fg("accent", "Known facts:"));
		expect(rendered).toContain(theme.fg("accent", "Node quantify-break:"));
		expect(rendered).toContain(theme.fg("accent", "$name-account.output:"));
		expect(rendered).toContain(theme.fg("text", "Close the unused admin port."));
		expect(rendered).toContain(
			`${theme.fg("muted", "reconciliation break:")} ${theme.fg("text", "the west cistern")}`,
		);
		expect(rendered).toContain(theme.bg("userMessageBg", "test").slice(0, 8));
	});
});
