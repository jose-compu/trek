import { describe, expect, it } from "vitest";
import { hasRepetitiveSuffix, isRepetitiveStreamText, StreamRepetitionGuard } from "../src/utils/stream-repetition.ts";

const LOOP_PHRASE =
	"Let me 1. Create SPICE netlists for the 4 designs 2. Create a Python runner that invokes ngspice 3. Fix run_simulations.py ";

const BABBLE_BLOCK = `The edit was successful. The file remains unchanged.

Would you like to proceed with anything else?

(No further action needed)
`;

describe("hasRepetitiveSuffix", () => {
	it("ignores short or non-repeating text", () => {
		expect(hasRepetitiveSuffix("short")).toBe(false);
		expect(hasRepetitiveSuffix("Plan the work, then call a tool once.\n".repeat(2))).toBe(false);
	});

	it("detects a planning phrase repeated three times", () => {
		expect(hasRepetitiveSuffix(LOOP_PHRASE.repeat(3))).toBe(true);
	});
});

describe("isRepetitiveStreamText", () => {
	it("trips on tiny-model fake wrap-up babble", () => {
		expect(isRepetitiveStreamText(BABBLE_BLOCK.repeat(4))).toBe(true);
	});

	it("trips on Would-you-like catchphrase spam", () => {
		const spam = Array.from(
			{ length: 5 },
			(_, i) => `The edit was done variant ${i}.\n\nWould you like to proceed?\n\n(Yes)\n\n`,
		).join("────────────────────────────────\n");
		expect(isRepetitiveStreamText(spam)).toBe(true);
	});

	it("does not trip on a normal short reply", () => {
		expect(isRepetitiveStreamText("Fixed the typo in README.md title.")).toBe(false);
	});
});

describe("StreamRepetitionGuard", () => {
	it("trips after streamed chunks form three identical suffixes", () => {
		const guard = new StreamRepetitionGuard();
		let tripped = false;
		for (const chunk of LOOP_PHRASE.repeat(3).match(/.{1,20}/g) ?? []) {
			if (guard.append(chunk)) {
				tripped = true;
				break;
			}
		}
		expect(tripped).toBe(true);
	});

	it("trips while streaming paraphrased babble", () => {
		const guard = new StreamRepetitionGuard();
		let tripped = false;
		const text = BABBLE_BLOCK.repeat(5);
		for (const chunk of text.match(/.{1,30}/g) ?? []) {
			if (guard.append(chunk)) {
				tripped = true;
				break;
			}
		}
		expect(tripped).toBe(true);
	});

	it("does not trip on progressive unique thinking", () => {
		const guard = new StreamRepetitionGuard();
		const text = Array.from({ length: 20 }, (_, i) => `Step ${i}: inspect file ${i} and continue.\n`).join("");
		expect(guard.append(text)).toBe(false);
	});
});
