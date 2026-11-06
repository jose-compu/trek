import { describe, expect, test } from "vitest";
import { CARD_GLYPH, cardGlyph, toolCardTitle } from "../src/modes/interactive/components/card-glyph.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

describe("card glyphs", () => {
	test("each card kind has a distinct mark", () => {
		const marks = Object.values(CARD_GLYPH);
		expect(new Set(marks).size).toBe(marks.length);
	});

	test("titles keep the tool name after the glyph", () => {
		initTheme("dark");
		expect(toolCardTitle(theme, "write")).toContain("write");
		expect(toolCardTitle(theme, "write")).toContain(cardGlyph("write"));
		expect(cardGlyph("unknown-tool")).toBe("▸");
	});
});
