import { matchesKey, parseKey } from "@trek/tui";
import { describe, expect, it } from "vitest";
import { KEYBINDINGS } from "../src/core/keybindings.ts";

function defaults(id: keyof typeof KEYBINDINGS): string[] {
	const keys = KEYBINDINGS[id].defaultKeys;
	if (Array.isArray(keys)) return [...keys];
	return keys ? [keys] : [];
}

describe("Terminal.app chords", () => {
	it("ctrl+z stays suspend and alt+z is undo", () => {
		expect(parseKey("\x1a")).toBe("ctrl+z");
		expect(defaults("app.suspend")).toContain("ctrl+z");
		expect(defaults("app.edits.undo")).toEqual(["alt+z"]);
		expect(matchesKey("\x1a", "alt+z")).toBe(false);
		expect(matchesKey("\x1bz", "alt+z")).toBe(true);
	});

	it("keep-all, dry-run, the shortcut bar, previous model, and filter back are alt chords", () => {
		expect(defaults("app.edits.keepAll")).toEqual(["alt+k"]);
		expect(defaults("app.edits.dryRun")).toEqual(["alt+u"]);
		expect(defaults("app.shortcuts.toggle")).toEqual(["alt+/"]);
		expect(defaults("app.model.cycleBackward")).toEqual(["alt+p"]);
		expect(defaults("app.tree.filter.cycleBackward")).toEqual(["alt+o"]);
		expect(defaults("app.thinking.cycle")).toEqual(["shift+tab"]);
		expect(matchesKey("\x1bk", "alt+k")).toBe(true);
		expect(matchesKey("\x1bu", "alt+u")).toBe(true);
		expect(matchesKey("\x1b/", "alt+/")).toBe(true);
		expect(matchesKey("\x1bp", "alt+p")).toBe(true);
		expect(matchesKey("\x1bo", "alt+o")).toBe(true);
	});
});
