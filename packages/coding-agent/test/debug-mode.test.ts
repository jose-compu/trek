import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { debugLog, isDebugEnabled, setDebugEnabled, setDebugLogPath } from "../src/utils/debug-log.ts";

describe("debug mode", () => {
	let tempDir: string;

	afterEach(() => {
		setDebugEnabled(false);
		setDebugLogPath(undefined);
		delete process.env.TREK_DEBUG;
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("debug logs only when enabled", () => {
		tempDir = mkdtempSync(join(tmpdir(), "trek-debug-test-"));
		const logPath = join(tempDir, "debug.log");
		setDebugLogPath(logPath);

		debugLog("test", "hidden");
		expect(() => readFileSync(logPath, "utf8")).toThrow();

		setDebugEnabled(true);
		debugLog("test", "visible", { ok: true });
		expect(readFileSync(logPath, "utf8")).toContain('[trek:debug:test] visible {"ok":true}');
	});

	test("TREK_DEBUG env enables debug logging", () => {
		process.env.TREK_DEBUG = "1";
		expect(isDebugEnabled()).toBe(true);
	});
});
