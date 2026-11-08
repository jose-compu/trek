import { describe, expect, it } from "vitest";
import { createBashTool } from "../src/core/tools/bash.ts";
import {
	DEFAULT_BLOCK_UNTIL_MS,
	formatBackgroundedBash,
	isServerReadyOutput,
	looksLikeServerCommand,
	MAX_TIMEOUT_SECONDS,
	resolveBlockUntilMs,
	resolveTimeoutSeconds,
	SERVER_BLOCK_UNTIL_MS,
} from "../src/core/tools/bash-background.ts";
import { killProcessTree } from "../src/utils/shell.ts";

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("");
}

describe("looksLikeServerCommand", () => {
	it("matches python http.server", () => {
		expect(looksLikeServerCommand("python3 -m http.server 62234")).toBe(true);
		expect(looksLikeServerCommand("python -m http.server")).toBe(true);
	});

	it("matches common dev servers", () => {
		expect(looksLikeServerCommand("npm start")).toBe(true);
		expect(looksLikeServerCommand("npx vite")).toBe(true);
		expect(looksLikeServerCommand("php -S 127.0.0.1:8080")).toBe(true);
	});

	it("does not match ordinary commands", () => {
		expect(looksLikeServerCommand("echo hello")).toBe(false);
		expect(looksLikeServerCommand("python3 calc.py")).toBe(false);
		expect(looksLikeServerCommand("sleep 40")).toBe(false);
	});
});

describe("resolveBlockUntilMs", () => {
	it("defaults every command to 8s, servers to 1.5s", () => {
		expect(resolveBlockUntilMs("python3 -m http.server 8000")).toBe(SERVER_BLOCK_UNTIL_MS);
		expect(resolveBlockUntilMs("echo hi")).toBe(DEFAULT_BLOCK_UNTIL_MS);
	});

	it("honors an explicit wait, and 0 means wait for exit", () => {
		expect(resolveBlockUntilMs("sleep 30", 250)).toBe(250);
		expect(resolveBlockUntilMs("sleep 30", 0)).toBeUndefined();
	});

	it("does not wait for exit on http.server even when the model passes 0 or a huge wait", () => {
		expect(resolveBlockUntilMs("python3 -m http.server 8000", 0)).toBe(SERVER_BLOCK_UNTIL_MS);
		expect(resolveBlockUntilMs("python3 -m http.server", 8000000)).toBe(SERVER_BLOCK_UNTIL_MS);
	});
});

describe("resolveTimeoutSeconds", () => {
	it("ignores timeout on server-like commands so 8000s cannot stall the turn", () => {
		expect(resolveTimeoutSeconds("python3 -m http.server 8000", 8000)).toBeUndefined();
		expect(resolveTimeoutSeconds("npx vite", 8000)).toBeUndefined();
	});

	it("caps ordinary command timeouts", () => {
		expect(resolveTimeoutSeconds("sleep 30", 30)).toBe(30);
		expect(resolveTimeoutSeconds("sleep 30", 8000)).toBe(MAX_TIMEOUT_SECONDS);
	});
});

describe("isServerReadyOutput", () => {
	it("matches python http.server bind lines", () => {
		expect(isServerReadyOutput("Serving HTTP on 127.0.0.1 port 62593 (http://127.0.0.1:62593/) ...")).toBe(true);
		expect(isServerReadyOutput("Serving HTTP on :: port 8000 (http://[::]:8000/) ...")).toBe(true);
		expect(isServerReadyOutput('::1 - - [08/Nov/2026 15:56:28] "GET /calculator.js HTTP/1.1" 404 -')).toBe(true);
		expect(isServerReadyOutput("error: address already in use")).toBe(false);
	});
});

describe("bash background", () => {
	it("returns after block_until_ms and leaves the process running", async () => {
		const bash = createBashTool(process.cwd());
		const started = Date.now();
		const result = await bash.execute("bg-1", { command: "sleep 20", block_until_ms: 400 });
		const elapsed = Date.now() - started;
		expect(elapsed).toBeLessThan(5000);
		expect(result.details?.backgrounded).toBe(true);
		const pid = result.details?.pid;
		expect(pid).toBeTypeOf("number");
		expect(getText(result)).toContain(`Started in background (pid ${pid})`);
		expect(() => process.kill(pid!, 0)).not.toThrow();
		killProcessTree(pid!);
	});

	it("does not crash when a backgrounded process prints after the tool returns", async () => {
		const bash = createBashTool(process.cwd());
		const errors: unknown[] = [];
		const onUncaught = (error: unknown) => {
			errors.push(error);
		};
		process.on("uncaughtException", onUncaught);
		try {
			const result = await bash.execute("bg-late", {
				command: "sh -c 'sleep 0.4; echo late-output; sleep 8'",
				block_until_ms: 120,
			});
			const pid = result.details?.pid;
			expect(result.details?.backgrounded).toBe(true);
			expect(pid).toBeTypeOf("number");
			await new Promise((resolve) => setTimeout(resolve, 700));
			expect(errors).toEqual([]);
			killProcessTree(pid!);
		} finally {
			process.off("uncaughtException", onUncaught);
		}
	});

	it("backgrounds as soon as a listen line is printed", async () => {
		const bash = createBashTool(process.cwd());
		const started = Date.now();
		const result = await bash.execute("bg-ready", {
			command: "sh -c 'echo Serving HTTP on 127.0.0.1 port 9; sleep 20'",
			block_until_ms: 8000,
		});
		const elapsed = Date.now() - started;
		expect(elapsed).toBeLessThan(3000);
		expect(result.details?.backgrounded).toBe(true);
		killProcessTree(result.details?.pid as number);
	});

	it("still waits for a short command to exit", async () => {
		const bash = createBashTool(process.cwd());
		const result = await bash.execute("fg-1", { command: "echo ready" });
		expect(result.details?.backgrounded).toBeUndefined();
		expect(getText(result)).toContain("ready");
		expect(getText(result)).not.toContain("Started in background");
	});

	it("backgrounds http.server even when the model passes timeout 8000 and block_until_ms 0", async () => {
		const bash = createBashTool(process.cwd());
		const started = Date.now();
		const result = await bash.execute("bg-http", {
			command: "python3 -m http.server 0",
			timeout: 8000,
			block_until_ms: 0,
		});
		const elapsed = Date.now() - started;
		expect(elapsed).toBeLessThan(5000);
		expect(result.details?.backgrounded).toBe(true);
		expect(getText(result)).toContain("Started in background");
		killProcessTree(result.details?.pid as number);
	});
});

describe("formatBackgroundedBash", () => {
	it("includes first output when present", () => {
		expect(formatBackgroundedBash(9, "Serving HTTP on 0.0.0.0 port 8000")).toContain("pid 9");
		expect(formatBackgroundedBash(9, "Serving HTTP on 0.0.0.0 port 8000")).toContain("Serving HTTP");
		expect(formatBackgroundedBash(9, "  ")).toContain("No output yet");
	});
});
