import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	benchmarkRuntime,
	defaultRuntimeConfig,
	formatBenchmark,
	resolveRuntime,
	withHierarchy,
	writeBenchmarkJson,
} from "../src/core/runtime/index.ts";

describe("benchmark report", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("records one measured row, skips absent weights, and writes JSON", () => {
		const local = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
			frontier: null,
		});
		const rows = benchmarkRuntime(local, {
			weightsAvailable: (role) => role === "tooling",
			measure: () => ({ tokensPerSecond: 12, toolCallLatencyMs: 40, memoryMb: 512 }),
		});
		const measured = rows.filter((row) => row.status === "measured");
		const skipped = rows.filter((row) => row.status === "skipped");
		expect(measured).toEqual([
			{ role: "tooling", status: "measured", tokensPerSecond: 12, toolCallLatencyMs: 40, memoryMb: 512 },
		]);
		expect(skipped.length).toBeGreaterThan(0);
		expect(skipped.every((row) => row.reason === "weights not on disk")).toBe(true);
		expect(formatBenchmark(rows)).toContain("memory 512 MB");
		const root = mkdtempSync(join(tmpdir(), "trek-benchmark-"));
		dirs.push(root);
		const path = join(root, "trek-benchmark.json");
		writeBenchmarkJson(path, rows);
		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(rows);
	});

	it("skips frontier in api mode", () => {
		const api = resolveRuntime(defaultRuntimeConfig(), { frontier: null });
		const rows = benchmarkRuntime(api, { weightsAvailable: () => true });
		expect(rows).toEqual([
			{ role: "frontier", status: "skipped", reason: "api mode has no local llama-server roles" },
		]);
	});
});
