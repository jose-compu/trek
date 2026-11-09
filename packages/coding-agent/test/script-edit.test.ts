/**
 * 0.19-B: script_edit engines, snapshot/invert, timeout, Law 1, compact card.
 * Run: npx vitest --run test/script-edit.test.ts --reporter=verbose
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLaw1 } from "../src/core/safety/laws.ts";
import { formatScriptEditCard, pickScriptEngine, runScriptEdit } from "../src/core/tools/script-edit.ts";
import { findOnPath, probeUnixTools, unixKitPath } from "../src/core/tools/unix-tools.ts";
import { nodeTrekStoreFs, TrekVersionStore } from "../src/core/trek-store/index.ts";
import { compactCardLines } from "../src/modes/interactive/components/compact-card.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function project(): string {
	const dir = mkdtempSync(join(tmpdir(), "trek-sedit-"));
	dirs.push(dir);
	mkdirSync(join(dir, ".git"));
	writeFileSync(join(dir, "notes.txt"), "foo line\nkeep\nfoo again\n");
	return dir;
}

function reportFor(pathEnv: string) {
	return probeUnixTools({ PATH: pathEnv, flavorOf: () => (process.platform === "darwin" ? "bsd" : "gnu") });
}

const kitPath = unixKitPath();

describe("pickScriptEngine", () => {
	it("falls back ex → vim → ed → sed", () => {
		const none = probeUnixTools({
			resolve: () => undefined,
		});
		expect(pickScriptEngine("auto", none)).toBeUndefined();
		expect(
			pickScriptEngine(
				"auto",
				probeUnixTools({
					resolve: (name) => (name === "sed" ? "/bin/sed" : undefined),
				}),
			),
		).toBe("sed");
		expect(
			pickScriptEngine(
				"auto",
				probeUnixTools({
					resolve: (name) => (name === "ed" || name === "sed" ? `/bin/${name}` : undefined),
				}),
			),
		).toBe("ed");
	});
});

describe("runScriptEdit", () => {
	it("rewrites with ex, vim -Es, ed, and sed without a TTY; invert restores", async () => {
		const engines = (["ex", "vim", "ed", "sed"] as const).filter((id) => findOnPath(id, kitPath));
		expect(engines.length).toBeGreaterThan(0);
		for (const engine of engines) {
			const cwd = project();
			const original = readFileSync(join(cwd, "notes.txt"), "utf8");
			const store = new TrekVersionStore(cwd, nodeTrekStoreFs);
			const script = engine === "sed" ? "s/foo/bar/g" : "%s/foo/bar/g\nwq\n";
			const result = await runScriptEdit(
				cwd,
				{ path: "notes.txt", script, engine },
				{ store, probe: reportFor(kitPath), timeoutMs: 5000 },
			);
			expect(result.killed).toBe(false);
			expect(result.dryRun).toBe(false);
			expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe("bar line\nkeep\nbar again\n");
			expect(result.diff).toContain("-foo");
			expect(result.diff).toContain("+bar");
			await store.restoreToPrompt(1);
			expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe(original);
		}
	});

	it("kills a hung ex", async () => {
		const cwd = project();
		const bin = join(cwd, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "ex"), "#!/bin/sh\nsleep 30\n");
		chmodSync(join(bin, "ex"), 0o755);
		const started = Date.now();
		await expect(
			runScriptEdit(
				cwd,
				{ path: "notes.txt", script: "%s/foo/bar/g", engine: "ex" },
				{ probe: probeUnixTools({ PATH: bin, flavorOf: () => "bsd" }), timeoutMs: 400 },
			),
		).rejects.toThrow(/timed out/);
		expect(Date.now() - started).toBeLessThan(4000);
		expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toContain("foo");
	});

	it("dry_run prints a diff and leaves the file", async () => {
		const engine = (["ex", "sed"] as const).find((id) => findOnPath(id, kitPath));
		if (!engine) {
			return;
		}
		const cwd = project();
		const original = readFileSync(join(cwd, "notes.txt"), "utf8");
		const script = engine === "sed" ? "s/foo/bar/g" : "%s/foo/bar/g\nwq\n";
		const result = await runScriptEdit(
			cwd,
			{ path: "notes.txt", script, engine, dry_run: true },
			{ probe: reportFor(kitPath), timeoutMs: 5000 },
		);
		expect(result.dryRun).toBe(true);
		expect(result.diff).toContain("+bar");
		expect(readFileSync(join(cwd, "notes.txt"), "utf8")).toBe(original);
	});
});

describe("Law 1", () => {
	it("lets script_edit proceed unread; snapshot is the read", async () => {
		const reason = await checkLaw1(
			{ toolName: "script_edit", args: { path: "notes.txt", script: "%s/a/b/g" }, tier: "cheap" },
			{
				halted: false,
				requireDestructiveConfirm: false,
				enforceReadBeforeWrite: true,
				hasReadFile: () => false,
				fileExists: async () => true,
				resolvePath: (p) => `/repo/${p}`,
			},
		);
		expect(reason).toBeUndefined();
	});

	it("still refuses write on an unread existing path", async () => {
		const reason = await checkLaw1(
			{ toolName: "write", args: { path: "notes.txt", content: "x" }, tier: "cheap" },
			{
				halted: false,
				requireDestructiveConfirm: false,
				enforceReadBeforeWrite: true,
				hasReadFile: () => false,
				fileExists: async () => true,
				resolvePath: (p) => `/repo/${p}`,
			},
		);
		expect(reason).toMatch(/read-before-write/i);
	});
});

describe("compact card", () => {
	it("is 1–4 lines; expanded shows the here-doc", () => {
		const script = "%s/foo/bar/g\ng/^#/d\nwq";
		const compact = formatScriptEditCard({
			engine: "ex",
			path: "notes.txt",
			script,
			status: "ok",
			added: 1,
			removed: 1,
		});
		const lines = compactCardLines(compact.split("\n"));
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.length).toBeLessThanOrEqual(4);
		expect(compact).toContain("%s/foo/bar/g");
		expect(compact).not.toContain("g/^#/d");
		const expanded = formatScriptEditCard({
			engine: "ex",
			path: "notes.txt",
			script,
			status: "ok",
			added: 1,
			removed: 1,
			expanded: true,
			diff: "--- a/notes.txt\n+++ b/notes.txt\n-foo\n+bar\n",
		});
		expect(expanded).toContain("g/^#/d");
		expect(expanded).toContain("wq");
		expect(expanded).toContain("+bar");
	});
});
