/**
 * 0.19-A: PATH probe and /tools unix. Never download.
 * Run: npx vitest --run test/unix-tools.test.ts --reporter=verbose
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	detectSedFlavor,
	findOnPath,
	formatUnixToolsReport,
	probeUnixTools,
	UNIX_TOOLS,
	UnixToolCache,
} from "../src/core/tools/unix-tools.ts";
import { runUnixToolsCommand, UNIX_TOOLS_COMMAND_USAGE } from "../src/core/unix-tools-command.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function fakeBin(names: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "trek-unix-"));
	dirs.push(dir);
	for (const name of names) {
		const path = join(dir, name);
		writeFileSync(path, "#!/bin/sh\nexit 0\n");
		chmodSync(path, 0o755);
	}
	return dir;
}

describe("findOnPath", () => {
	it("returns the first matching file on PATH", () => {
		const dir = fakeBin(["ex"]);
		expect(findOnPath("ex", dir)).toBe(join(dir, "ex"));
		expect(findOnPath("vim", dir)).toBeUndefined();
	});

	it("returns undefined for an empty PATH", () => {
		expect(findOnPath("ex", "")).toBeUndefined();
	});
});

describe("probeUnixTools", () => {
	it("reports present and missing tools on a fake PATH", () => {
		const dir = fakeBin(["ex", "ed", "sed", "jq"]);
		const report = probeUnixTools({
			PATH: dir,
			flavorOf: () => "bsd",
		});
		const byId = Object.fromEntries(report.tools.map((tool) => [tool.id, tool]));
		expect(byId.ex).toMatchObject({ present: true, path: join(dir, "ex"), optional: false });
		expect(byId.ed).toMatchObject({ present: true, path: join(dir, "ed") });
		expect(byId.sed).toMatchObject({ present: true, path: join(dir, "sed"), flavor: "bsd" });
		expect(byId.jq).toMatchObject({ present: true, path: join(dir, "jq") });
		expect(byId.vim).toMatchObject({ present: false, optional: false });
		expect(byId.sg).toMatchObject({ present: false, optional: true });
		expect(byId.mlr).toMatchObject({ present: false, optional: true });
	});

	it("does not call fetch when tools are missing", () => {
		const original = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (() => {
			calls += 1;
			return Promise.reject(new Error("unix-tools must not download"));
		}) as typeof fetch;
		try {
			const report = probeUnixTools({ PATH: "" });
			expect(report.tools.every((tool) => !tool.present)).toBe(true);
			expect(calls).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe("UnixToolCache", () => {
	it("probes once per session", () => {
		let scans = 0;
		const cache = new UnixToolCache({
			resolve: (name) => {
				scans += 1;
				return name === "ex" ? "/tmp/ex" : undefined;
			},
			flavorOf: () => "gnu",
		});
		const first = cache.get();
		const second = cache.get();
		expect(first).toBe(second);
		expect(scans).toBe(UNIX_TOOLS.length);
		expect(first.tools.find((tool) => tool.id === "ex")?.path).toBe("/tmp/ex");
	});
});

describe("formatUnixToolsReport", () => {
	it("marks optional misses as skip", () => {
		const text = formatUnixToolsReport(
			probeUnixTools({
				resolve: (name) => (name === "sed" ? "/bin/sed" : undefined),
				flavorOf: () => "gnu",
			}),
		);
		expect(text).toMatch(/^unix tools$/m);
		expect(text).toMatch(/^sed\s+\/bin\/sed\s+gnu$/m);
		expect(text).toMatch(/^ex\s+missing$/m);
		expect(text).toMatch(/^sg\s+missing\s+skip$/m);
		expect(text).toMatch(/^mlr\s+missing\s+skip$/m);
		expect(text).not.toMatch(/^ex\s+missing\s+skip$/m);
	});
});

describe("runUnixToolsCommand", () => {
	it("prints the probe for /tools and /tools unix", () => {
		const cache = new UnixToolCache({
			resolve: (name) => (name === "rg" ? "/usr/bin/rg" : undefined),
		});
		const expected = formatUnixToolsReport(cache.get());
		expect(runUnixToolsCommand("", cache)).toBe(expected);
		expect(runUnixToolsCommand("unix", cache)).toBe(expected);
	});

	it("prints usage for an unknown subcommand", () => {
		const cache = new UnixToolCache({ PATH: "" });
		expect(runUnixToolsCommand("download sg", cache)).toBe(UNIX_TOOLS_COMMAND_USAGE);
	});
});

describe("detectSedFlavor", () => {
	it("classifies the system sed when it is on PATH", () => {
		const sed = findOnPath("sed", process.env.PATH ?? "");
		if (!sed) {
			return;
		}
		const flavor = detectSedFlavor(sed);
		expect(["bsd", "gnu", "unknown"]).toContain(flavor);
		if (process.platform === "darwin" && sed === "/usr/bin/sed") {
			expect(flavor).toBe("bsd");
		}
	});
});
