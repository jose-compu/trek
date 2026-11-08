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

	test("collapses an internal step prompt to one dim line without a grey bar", () => {
		initTheme("dark");
		const component = new UserMessageComponent(
			[
				"Answer this step only.",
				"One line. No preamble.",
				"",
				"User turn:",
				"Close the unused admin port.",
				"",
				"Step quantify-break:",
				"Separate what is known from what is estimated.",
			].join("\n"),
		);
		const rendered = component.render(80).join("\n");
		expect(rendered).toContain(theme.fg("dim", "· quantify-break"));
		expect(rendered).not.toContain("Answer this step only.");
		expect(rendered).not.toContain("Archon");
		expect(rendered).not.toContain("User turn:");
		expect(rendered).not.toContain(theme.bg("userMessageBg", "test").slice(0, 8));
	});

	test("collapses a layering continue prompt to one dim line", () => {
		initTheme("dark");
		const rendered = new UserMessageComponent("Continue the layering task.\n\nUser turn:\nDebug the race.")
			.render(80)
			.join("\n");
		expect(rendered).toContain(theme.fg("dim", "· continue"));
		expect(rendered).not.toContain("User turn:");
	});
});
