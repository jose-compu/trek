import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { debugLog, setDebugEnabled, setDebugLogPath } from "../src/utils/debug-log.ts";
import { redactArgv, redactDebugData, redactSecretText } from "../src/utils/debug-redact.ts";

describe("debug redact", () => {
	let tempDir: string;

	afterEach(() => {
		setDebugEnabled(false);
		setDebugLogPath(undefined);
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test("redactArgv masks --api-key value and =value form", () => {
		expect(redactArgv(["trek", "--api-key", "sk-or-v1-secret", "--model", "openrouter/free"])).toEqual([
			"trek",
			"--api-key",
			"[redacted]",
			"--model",
			"openrouter/free",
		]);
		expect(redactArgv(["--api-key=sk-ant-abcdef0123456789"])).toEqual(["--api-key=[redacted]"]);
	});

	test("redactSecretText covers OpenRouter, Anthropic, xAI, and Bearer shapes", () => {
		expect(redactSecretText("key sk-or-v1-abcdefghijklmnop")).toContain("[redacted]");
		expect(redactSecretText("key sk-ant-api03-abcdefghijklmnop")).toContain("[redacted]");
		expect(redactSecretText("key xai-abcdefghijklmnop")).toContain("[redacted]");
		expect(redactSecretText("Authorization: Bearer abcdefghijklmnop1234")).toContain("[redacted]");
		expect(redactSecretText("plain model id")).toBe("plain model id");
	});

	test("redactDebugData masks argv and secret object keys", () => {
		expect(
			redactDebugData({
				argv: ["--debug", "--api-key", "sk-live-abcdefghijklmnop"],
				apiKey: "sk-ant-secretvalue12",
				ok: true,
			}),
		).toEqual({
			argv: ["--debug", "--api-key", "[redacted]"],
			apiKey: "[redacted]",
			ok: true,
		});
	});

	test("debugLog never writes --api-key material to the log file", () => {
		tempDir = mkdtempSync(join(tmpdir(), "trek-debug-redact-"));
		const logPath = join(tempDir, "debug.log");
		setDebugLogPath(logPath);
		setDebugEnabled(true);

		const secret = "sk-or-v1-do-not-log-this-key";
		debugLog("startup", "debug mode enabled", { argv: ["trek", "--api-key", secret, "--debug"] });

		const body = readFileSync(logPath, "utf8");
		expect(body).toContain("--api-key");
		expect(body).toContain("[redacted]");
		expect(body).not.toContain(secret);
	});
});
