import { describe, expect, it } from "vitest";
import { hasRepetitiveSuffix, StreamRepetitionGuard } from "../src/utils/stream-repetition.ts";

const LOOP_PHRASE =
	"Let me 1. Create SPICE netlists for the 4 designs 2. Create a Python runner that invokes ngspice 3. Fix run_simulations.py ";

describe("hasRepetitiveSuffix", () => {
	it("ignores short or non-repeating text", () => {
		expect(hasRepetitiveSuffix("short")).toBe(false);
		expect(hasRepetitiveSuffix("Plan the work, then call a tool once.\n".repeat(2))).toBe(false);
	});

	it("detects a planning phrase repeated three times", () => {
		expect(hasRepetitiveSuffix(LOOP_PHRASE.repeat(3))).toBe(true);
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

	it("does not trip on progressive unique thinking", () => {
		const guard = new StreamRepetitionGuard();
		const text = Array.from({ length: 20 }, (_, i) => `Step ${i}: inspect file ${i} and continue.\n`).join("");
		expect(guard.append(text)).toBe(false);
	});
});
