import { describe, expect, test } from "vitest";
import { honestyStatusLine, parseHonestyReport, stripHonestyFooter } from "../src/core/honesty/index.ts";

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

	test("hides an echoed template and an unclosed tag", () => {
		const echoed = "Hello.\n\n<honesty>confidence: high|medium|low</honesty>";
		expect(stripHonestyFooter(echoed)).toBe("Hello.");
		expect(parseHonestyReport(echoed).confidence).toBeUndefined();
		expect(honestyStatusLine(echoed)).toBeUndefined();
		expect(stripHonestyFooter("Hello.\n<honesty>confidence: med")).toBe("Hello.");
		expect(honestyStatusLine("Done.\n<honesty>\nconfidence: low\nassumption: none\n</honesty>")).toBe(
			"honesty confidence=low assumptions=0 unverified=0",
		);
		expect(
			honestyStatusLine(
				"<honesty>\nconfidence: medium\nassumption: guessed the path\nunverified: the tests pass\n</honesty>",
			),
		).toBe(
			"honesty confidence=medium assumptions=1 unverified=1   assumption: guessed the path   unverified: the tests pass",
		);
	});

	test("drops trailing honesty chatter from the answer", () => {
		const text = [
			"Created app.py.",
			"",
			"High. Excited!",
			"Your request is fulfilled.",
			"The end is approaching. Good luck! 💪",
			"</Task is complete. Let's build!>",
		].join("\n");
		expect(stripHonestyFooter(text)).toBe("Created app.py.");
	});
});
