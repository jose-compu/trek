/**
 * 0.17 #112: budget file is the intentional-bump surface.
 * Run: npx vitest --run test/performance-budgets.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { BUDGET_METRICS, loadPerformanceBudgets } from "./performance-budgets.ts";

describe("0.17 performance budgets", () => {
	it("requires an explicit JSON bump to raise a gate", () => {
		const file = loadPerformanceBudgets();
		expect(file.version).toBe(1);
		expect(file.comment.toLowerCase()).toMatch(/raise|bump/);
		for (const metric of BUDGET_METRICS) {
			expect(file.budgets_ms[metric]).toBeGreaterThan(0);
			expect(file.recorded_ms[metric]).toBeGreaterThan(0);
			expect(file.budgets_ms[metric]).toBeGreaterThan(file.recorded_ms[metric]);
		}
	});
});
