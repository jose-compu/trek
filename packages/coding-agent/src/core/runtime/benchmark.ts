/**
 * trek models benchmark (issue #89).
 * Missing weights are skipped. CI does not download GGUF files.
 */

import { writeFileSync } from "node:fs";
import type { ResolvedRuntime } from "./resolve.ts";
import type { LocalServerRole } from "./types.ts";
import { SESSION_LOCAL_ROLES } from "./types.ts";

export interface BenchmarkRow {
	role: string;
	status: "skipped" | "measured";
	reason?: string;
	tokensPerSecond?: number;
	toolCallLatencyMs?: number;
	memoryMb?: number;
}

export interface BenchmarkSample {
	tokensPerSecond: number;
	toolCallLatencyMs: number;
	memoryMb: number;
}

export interface BenchmarkProbe {
	weightsAvailable: (role: LocalServerRole, modelId: string) => boolean;
	measure?: (role: LocalServerRole) => BenchmarkSample;
}

export function benchmarkRuntime(resolved: ResolvedRuntime, probe: BenchmarkProbe): BenchmarkRow[] {
	if (resolved.effectiveMode === "api") {
		return [{ role: "frontier", status: "skipped", reason: "api mode has no local llama-server roles" }];
	}
	return SESSION_LOCAL_ROLES.map((role) => {
		const assignment = resolved.roles[role];
		if (!assignment) {
			return { role, status: "skipped", reason: "role unassigned" };
		}
		if (!probe.weightsAvailable(role, assignment.id)) {
			return { role, status: "skipped", reason: "weights not on disk" };
		}
		if (!probe.measure) {
			return { role, status: "skipped", reason: "weights present; no measurement hook" };
		}
		const sample = probe.measure(role);
		return {
			role,
			status: "measured",
			tokensPerSecond: sample.tokensPerSecond,
			toolCallLatencyMs: sample.toolCallLatencyMs,
			memoryMb: sample.memoryMb,
		};
	});
}

export function formatBenchmark(rows: readonly BenchmarkRow[]): string {
	return rows
		.map((row) => {
			if (row.status === "skipped") {
				return `${row.role}: skipped (${row.reason ?? "skipped"})`;
			}
			const memory = row.memoryMb === undefined ? "" : `, memory ${row.memoryMb} MB`;
			return `${row.role}: ${row.tokensPerSecond} tok/s, tool-call ${row.toolCallLatencyMs} ms${memory}`;
		})
		.join("\n");
}

export function writeBenchmarkJson(path: string, rows: readonly BenchmarkRow[]): void {
	writeFileSync(path, `${JSON.stringify(rows, null, "\t")}\n`);
}
