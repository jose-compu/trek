/**
 * Optional `trek models benchmark --layering`. Fixture traces only in CI.
 * Live keys/weights skip that arm. Not a CI gate.
 */

import { writeFileSync } from "node:fs";

export interface LayeringBenchmarkArm {
	wallClockMs: number;
	tokens: number;
	usd: number;
	solved: number;
	tasks: number;
}

export interface LayeringBenchmarkReport {
	single: LayeringBenchmarkArm;
	layered: LayeringBenchmarkArm;
	costPerSolved: { single: number; layered: number };
	routeMix: Record<string, number>;
	liveSkipped: boolean;
}

export interface LayeringBenchmarkTrace {
	mode: "single" | "layered";
	wallClockMs: number;
	tokens: number;
	usd: number;
	solved: boolean;
	route: string;
}

const EMPTY_ARM: LayeringBenchmarkArm = { wallClockMs: 0, tokens: 0, usd: 0, solved: 0, tasks: 0 };

export function defaultLayeringTraces(): LayeringBenchmarkTrace[] {
	return [
		{ mode: "single", wallClockMs: 1200, tokens: 800, usd: 0.02, solved: true, route: "workhorse" },
		{ mode: "single", wallClockMs: 900, tokens: 400, usd: 0.01, solved: true, route: "script" },
		{ mode: "single", wallClockMs: 1800, tokens: 1400, usd: 0.04, solved: false, route: "workhorse" },
		{ mode: "layered", wallClockMs: 400, tokens: 80, usd: 0, solved: true, route: "script" },
		{ mode: "layered", wallClockMs: 1100, tokens: 600, usd: 0.015, solved: true, route: "workhorse" },
		{ mode: "layered", wallClockMs: 2200, tokens: 1800, usd: 0.06, solved: true, route: "planning" },
	];
}

export function benchmarkLayering(
	traces: readonly LayeringBenchmarkTrace[] = defaultLayeringTraces(),
	liveSkipped = Boolean(process.env.CI),
): LayeringBenchmarkReport {
	const single = arm("single", traces);
	const layered = arm("layered", traces);
	const routeMix: Record<string, number> = {};
	for (const trace of traces) {
		routeMix[trace.route] = (routeMix[trace.route] ?? 0) + 1;
	}
	return {
		single,
		layered,
		costPerSolved: {
			single: costPerSolved(single),
			layered: costPerSolved(layered),
		},
		routeMix,
		liveSkipped,
	};
}

export function writeLayeringBenchmarkJson(path: string, report: LayeringBenchmarkReport): void {
	writeFileSync(path, `${JSON.stringify(report, null, "\t")}\n`);
}

function arm(mode: "single" | "layered", traces: readonly LayeringBenchmarkTrace[]): LayeringBenchmarkArm {
	const rows = traces.filter((trace) => trace.mode === mode);
	if (rows.length === 0) {
		return { ...EMPTY_ARM };
	}
	return {
		wallClockMs: rows.reduce((sum, row) => sum + row.wallClockMs, 0),
		tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
		usd: rows.reduce((sum, row) => sum + row.usd, 0),
		solved: rows.filter((row) => row.solved).length,
		tasks: rows.length,
	};
}

function costPerSolved(row: LayeringBenchmarkArm): number {
	if (row.solved === 0) {
		return 0;
	}
	return row.usd / row.solved;
}
