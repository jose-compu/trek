import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { debugLog, setDebugEnabled, setDebugLogPath } from "../src/utils/debug-log.ts";
import { buildRenderDebugLog, redactArgv, redactDebugData, redactSecretText } from "../src/utils/debug-redact.ts";

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

	test("buildRenderDebugLog redacts secrets in rendered lines and keeps original visible width", () => {
		const secretLine = "model sk-or-v1-do-not-log-this-key auth Bearer abcdefghijklmnop1234";
		const out = buildRenderDebugLog({
			width: 80,
			height: 24,
			allLines: ["Terminal: 80x24", secretLine],
			messages: [],
		});
		expect(out).toContain("Terminal: 80x24");
		expect(out).toContain("Total lines: 2");
		const widthMatch = out.match(/\[1\] \(w=(\d+)\)/);
		expect(widthMatch).not.toBeNull();
		expect(Number(widthMatch![1])).toBe(secretLine.length);
		expect(out).toContain("[redacted]");
		expect(out).not.toContain("sk-or-v1-do-not-log-this-key");
		expect(out).not.toContain("Bearer abcdefghijklmnop1234");
	});

	test("buildRenderDebugLog redacts secret keys and embedded tokens in session messages", () => {
		const out = buildRenderDebugLog({
			width: 80,
			height: 24,
			allLines: [],
			messages: [
				{
					apiKey: "not-a-provider-shape",
					content: "token sk-ant-api03-abcdefghijklmnop",
				},
			],
		});
		expect(out).toContain('"apiKey":"[redacted]"');
		expect(out).toContain('"content":"token [redacted]"');
		expect(out).not.toContain("not-a-provider-shape");
		expect(out).not.toContain("sk-ant-api03-abcdefghijklmnop");
	});

	test("buildRenderDebugLog leaves plain rendered lines and messages intact", () => {
		const plainLine = "plain status line";
		const out = buildRenderDebugLog({
			width: 80,
			height: 24,
			allLines: [plainLine],
			messages: [{ role: "user", content: "hello" }],
		});
		expect(out).toContain("Terminal: 80x24");
		expect(out).toContain("Total lines: 1");
		expect(out).toContain(JSON.stringify(plainLine));
		expect(out).toContain('"content":"hello"');
		expect(out).not.toContain("[redacted]");
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
