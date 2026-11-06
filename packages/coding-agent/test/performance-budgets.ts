/**
 * 0.17 #112: explicit latency budgets. Bump performance-budgets.json to accept a slower time.
 * Run: npx vitest --run test/performance-budgets.test.ts --reporter=verbose
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

export const BUDGET_METRICS = ["first_prompt_ms", "reflective_loop_ms", "jsonl_append_400_ms"] as const;
export type BudgetMetric = (typeof BUDGET_METRICS)[number];

export interface PerformanceBudgetsFile {
	version: number;
	updated: string;
	comment: string;
	budgets_ms: Record<BudgetMetric, number>;
	recorded_ms: Record<BudgetMetric, number>;
}

const budgetsPath = join(dirname(fileURLToPath(import.meta.url)), "performance-budgets.json");

export function loadPerformanceBudgets(): PerformanceBudgetsFile {
	return JSON.parse(readFileSync(budgetsPath, "utf-8")) as PerformanceBudgetsFile;
}

export function assertUnderBudget(metric: BudgetMetric, measuredMs: number): void {
	const budget = loadPerformanceBudgets().budgets_ms[metric];
	expect(
		measuredMs,
		`${metric}=${measuredMs}ms exceeded budget ${budget}ms. Bump test/performance-budgets.json if this is intentional.`,
	).toBeLessThanOrEqual(budget);
}
