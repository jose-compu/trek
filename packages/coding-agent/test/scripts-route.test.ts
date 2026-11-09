/**
 * 0.19-E: Decision/Scripts route with zero model calls.
 * Run: npx vitest --run test/scripts-route.test.ts --reporter=verbose
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { constrainDecisionRoute } from "../src/core/runtime/layer-decision.ts";
import { parseScriptsIntent, replaceScript, runScriptsIntent } from "../src/core/scripts-route.ts";
import { findOnPath, unixKitPath } from "../src/core/tools/unix-tools.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("parseScriptsIntent", () => {
	it("formats an ex script with wq and a sed program without it", () => {
		expect(replaceScript("foo", "bar", "ex")).toBe("%s/foo/bar/g\nwq\n");
		expect(replaceScript("foo", "bar", "sed")).toBe("s/foo/bar/g");
		expect(replaceScript("a.b", "x&y", "sed")).toBe("s/a\\.b/x\\&y/g");
	});

	it("parses replace X with Y in F", () => {
		expect(parseScriptsIntent("replace foo with bar in a.txt")).toEqual({
			kind: "replace",
			from: "foo",
			to: "bar",
			path: "a.txt",
		});
		expect(parseScriptsIntent("please rewrite the module")).toBeUndefined();
	});
});

describe("runScriptsIntent", () => {
	it("runs replace with zero model calls", async () => {
		const modelCalls = 0;
		let sawDryRun = false;
		const output = await runScriptsIntent(
			"/tmp",
			{ kind: "replace", from: "foo", to: "bar", path: "a.txt" },
			{
				dryRun: () => true,
				runEdit: async (_cwd, _input, options) => {
					sawDryRun = options?.dryRun?.() === true;
					return {
						engine: "ex",
						path: "a.txt",
						script: "",
						before: "foo",
						after: "bar",
						diff: "",
						added: 1,
						removed: 1,
						stdout: "",
						stderr: "",
						killed: false,
						dryRun: true,
					};
				},
			},
		);
		expect(modelCalls).toBe(0);
		expect(sawDryRun).toBe(true);
		expect(output).toContain("script_edit");
		expect(output).toContain("a.txt");
		expect(output).toContain("dry-run");
	});

	it("rewrites a file through the Unix kit", async () => {
		if (!["ex", "vim", "ed", "sed"].some((id) => findOnPath(id, unixKitPath()))) {
			return;
		}
		const cwd = mkdtempSync(join(tmpdir(), "trek-scripts-"));
		dirs.push(cwd);
		mkdirSync(join(cwd, ".git"));
		writeFileSync(join(cwd, "a.txt"), "foo\n");
		await runScriptsIntent(cwd, { kind: "replace", from: "foo", to: "bar", path: "a.txt" });
		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("bar\n");
	});
});

describe("Decision route", () => {
	it("keeps target script", () => {
		const decision = constrainDecisionRoute({
			action: "continue",
			target: "script",
			thinking: "off",
			confidence: "high",
			reason: "replace foo with bar in a.txt",
			evidence: [],
		});
		expect(decision.target).toBe("script");
	});
});
