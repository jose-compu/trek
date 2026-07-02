import { describe, expect, test } from "vitest";
import { parseHonestyReport, stripHonestyFooter } from "../src/core/honesty/index.ts";

describe("honesty protocol (#4/#6)", () => {
	test("parses confidence, assumption ledger, and unverified claims", () => {
		const text = `Done editing.

<honesty>
confidence: medium
assumption: assumed the build uses vitest
assumption: assumed node 20+
unverified: the CI pipeline runs on push
</honesty>`;
		const report = parseHonestyReport(text);
		expect(report.present).toBe(true);
		expect(report.confidence).toBe("medium");
		expect(report.assumptions).toEqual(["assumed the build uses vitest", "assumed node 20+"]);
		expect(report.unverified).toEqual(["the CI pipeline runs on push"]);
	});

	test("treats 'none' as empty ledger", () => {
		const text = `<honesty>
confidence: high
assumption: none
unverified: none
</honesty>`;
		const report = parseHonestyReport(text);
		expect(report.confidence).toBe("high");
		expect(report.assumptions).toEqual([]);
		expect(report.unverified).toEqual([]);
	});

	test("absent footer reports not present", () => {
		const report = parseHonestyReport("just a normal answer");
		expect(report.present).toBe(false);
		expect(report.confidence).toBeUndefined();
	});

	test("stripHonestyFooter removes the footer for display", () => {
		const text = "Answer body.\n\n<honesty>\nconfidence: low\n</honesty>";
		expect(stripHonestyFooter(text)).toBe("Answer body.");
	});
});
