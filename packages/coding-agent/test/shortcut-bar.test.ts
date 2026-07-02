import { setKeybindings } from "@trek/tui";
import { beforeEach, describe, expect, test } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
	cycleShortcutBarVisibility,
	ShortcutBarComponent,
	type ShortcutBarVisibility,
} from "../src/modes/interactive/components/shortcut-bar.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("ShortcutBarComponent", () => {
	beforeEach(() => {
		initTheme("dark");
		setKeybindings(KeybindingsManager.create());
	});
	test("cycles hidden → compact → expanded → hidden", () => {
		expect(cycleShortcutBarVisibility("hidden")).toBe("compact");
		expect(cycleShortcutBarVisibility("compact")).toBe("expanded");
		expect(cycleShortcutBarVisibility("expanded")).toBe("hidden");
	});

	test("renders compact line with guardrails shortcuts", () => {
		const visibility: ShortcutBarVisibility = "compact";
		const bar = new ShortcutBarComponent(() => visibility);
		const lines = bar.render(200);
		expect(lines.length).toBe(1);
		expect(lines[0]).toMatch(/undo|dry-run|stop/i);
	});

	test("expanded mode renders multiple sections", () => {
		const bar = new ShortcutBarComponent(() => "expanded");
		const lines = bar.render(120);
		expect(lines.length).toBeGreaterThan(2);
		expect(lines.some((l) => l.includes("Safety"))).toBe(true);
	});

	test("hidden mode shows only toggle hint", () => {
		const bar = new ShortcutBarComponent(() => "hidden");
		const lines = bar.render(80);
		expect(lines.length).toBe(1);
		expect(lines[0].toLowerCase()).toMatch(/shortcut/);
	});
});
