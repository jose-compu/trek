import { describe, expect, test } from "vitest";
import { AsciiBannerComponent, BANNER_LINES } from "../src/modes/interactive/components/ascii-banner.ts";
import {
	COMPACT_PRODUCT_NAME,
	formatFooterProductTag,
	formatPromptBorderChrome,
} from "../src/modes/interactive/components/prompt-chrome.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("prompt chrome", () => {
	test("prompt border is the id only", () => {
		expect(formatPromptBorderChrome(1)).toBe("[#1]");
		expect(formatPromptBorderChrome(2)).toBe("[#2]");
	});

	test("footer tag sits next to the working folder", () => {
		expect(COMPACT_PRODUCT_NAME).toBe("trek-agent");
		expect(formatFooterProductTag("0.16.1")).toBe(":trek-agent@0.16.1");
	});
});

describe("TREK AGENT banner", () => {
	test("keeps the compact unicode TREK AGENT art", () => {
		expect(BANNER_LINES).toEqual(["▄▖▄▖▄▖▖▖  ▄▖▄▖▄▖▖ ▖▄▖", "▐ ▙▘▙▖▙▘  ▌▌▌ ▙▖▛▖▌▐ ", "▐ ▌▌▙▖▌▌  ▛▌▙▌▙▖▌▝▌▐ "]);
	});

	test("is hidden while compact and persistent while expanded", () => {
		initTheme("dark");
		const banner = new AsciiBannerComponent(false);
		expect(banner.render(80)).toEqual([]);
		banner.setExpanded(true);
		expect(banner.render(80)).toHaveLength(3);
		banner.setExpanded(false);
		expect(banner.render(80)).toEqual([]);
	});
});
