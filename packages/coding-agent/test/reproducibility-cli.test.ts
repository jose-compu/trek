/**
 * 0.7.0 Audit — warnings + trek config reproducibility (#72, #74).
 * Run: npx vitest run test/reproducibility-cli.test.ts --reporter=verbose
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import {
	formatDeterminismWarning,
	formatProviderSupportTable,
	resolveReproducibility,
} from "../src/core/reproducibility/index.ts";
import { handleReproducibilityConfig } from "../src/reproducibility-cli.ts";

function captureStdio(): { logs: string[]; errors: string[]; restore: () => void } {
	const logs: string[] = [];
	const errors: string[] = [];
	const log = console.log;
	const err = console.error;
	console.log = (...args: unknown[]) => {
		logs.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	};
	return {
		logs,
		errors,
		restore: () => {
			console.log = log;
			console.error = err;
		},
	};
}

describe("determinism warnings (#72)", () => {
	const resolved = resolveReproducibility({ settings: { seed: 42 } });

	it("warns for anthropic and stays silent for faux", () => {
		expect(formatDeterminismWarning("anthropic", resolved)).toMatch(/cannot honor determinism/);
		expect(formatDeterminismWarning("faux", resolved)).toBeUndefined();
	});

	it("lists provider support", () => {
		const table = formatProviderSupportTable();
		expect(table).toContain("anthropic");
		expect(table).toContain("no seed");
		expect(table).toContain("openai");
	});
});

describe("trek config reproducibility (#74)", () => {
	const dirs: string[] = [];
	const previousAgentDir = process.env[ENV_AGENT_DIR];

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = previousAgentDir;
		}
		while (dirs.length > 0) {
			rmSync(dirs.pop()!, { recursive: true, force: true });
		}
	});

	it("prints current status and persists --mode/--seed", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "trek-repro-cli-"));
		dirs.push(agentDir);
		process.env[ENV_AGENT_DIR] = agentDir;

		const stdio = captureStdio();
		expect(
			await handleReproducibilityConfig(["config", "reproducibility", "--mode", "strict_audit", "--seed", "9"]),
		).toBe(true);
		stdio.restore();

		expect(stdio.logs.join("\n")).toMatch(/mode: strict_audit/);
		expect(stdio.logs.join("\n")).toMatch(/seed: 9/);
		const saved = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
		expect(saved.reproducibility).toEqual({ mode: "strict_audit", seed: 9 });
	});

	it("rejects a bad mode", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "trek-repro-cli-"));
		dirs.push(agentDir);
		process.env[ENV_AGENT_DIR] = agentDir;
		const stdio = captureStdio();
		const previousExit = process.exitCode;
		expect(await handleReproducibilityConfig(["config", "reproducibility", "--mode", "nope"])).toBe(true);
		stdio.restore();
		expect(stdio.errors.join("\n")).toMatch(/Invalid --mode/);
		process.exitCode = previousExit;
	});
});
