/**
 * 0.19-C: refuse interactive editors, dd, find -delete; cap xargs -P.
 * In-place sed/vim -Es become script_edit or stay on bash (no error).
 * Run: npx vitest --run test/unix-guards.test.ts --reporter=verbose
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import {
	extractInplacePaths,
	inspectBashCommand,
	MAX_XARGS_PARALLEL,
	parseSedInplace,
} from "../src/core/tools/unix-guards.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("inspectBashCommand", () => {
	it("refuses bare vim and other TUIs", () => {
		expect(inspectBashCommand("vim notes.txt")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("vi notes.txt")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("nano notes.txt")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("emacs notes.txt")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("less notes.txt")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("more notes.txt")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("echo ok; vim notes.txt")).toMatchObject({ action: "refuse" });
	});

	it("turns a lone sed -i into script_edit", () => {
		expect(inspectBashCommand("sed -i 's/foo/bar/g' notes.txt")).toEqual({
			action: "script_edit",
			edit: { engine: "sed", path: "notes.txt", script: "s/foo/bar/g" },
		});
		expect(inspectBashCommand("sed -i '' 's/v1\\.3\\.0/v1.6.0/g' website/index.html")).toEqual({
			action: "script_edit",
			edit: { engine: "sed", path: "website/index.html", script: "s/v1\\.3\\.0/v1.6.0/g" },
		});
	});

	it("lets mixed bash with sed -i run", () => {
		const mixed = `sed -i '' 's/v1\\.3\\.0/v1.6.0/g' website/index.html
grep -n '1\\.3' website/index.html | head -20
git add -A`;
		expect(inspectBashCommand(mixed)).toEqual({ action: "ok", command: mixed });
		expect(inspectBashCommand("ex -s notes.txt")).toMatchObject({ action: "ok" });
	});

	it("turns a lone vim -Es -c into script_edit", () => {
		expect(inspectBashCommand("vim -Es -c wq notes.txt")).toMatchObject({
			action: "script_edit",
			edit: { engine: "vim", path: "notes.txt", script: "wq\n" },
		});
	});

	it("refuses dd and find -delete", () => {
		expect(inspectBashCommand("dd if=/dev/zero of=disk.img")).toMatchObject({ action: "refuse" });
		expect(inspectBashCommand("find . -name '*.tmp' -delete")).toMatchObject({ action: "refuse" });
	});

	it("caps xargs -P at 4", () => {
		const result = inspectBashCommand("xargs -P 64 -n 1 echo");
		expect(result).toEqual({
			action: "rewrite",
			command: `xargs -P ${MAX_XARGS_PARALLEL} -n 1 echo`,
		});
		expect(inspectBashCommand("xargs -P 2 echo")).toEqual({ action: "ok", command: "xargs -P 2 echo" });
	});
});

describe("parseSedInplace", () => {
	it("parses GNU, BSD empty suffix, and -e", () => {
		expect(parseSedInplace("sed -i 's/foo/bar/g' notes.txt")).toEqual({
			engine: "sed",
			path: "notes.txt",
			script: "s/foo/bar/g",
		});
		expect(parseSedInplace("sed -i '' 's/a/b/g' website/index.html")).toEqual({
			engine: "sed",
			path: "website/index.html",
			script: "s/a/b/g",
		});
		expect(parseSedInplace("sed -i -e 's/a/b/' file.txt")).toEqual({
			engine: "sed",
			path: "file.txt",
			script: "s/a/b/",
		});
	});

	it("collects inplace paths from a mixed script", () => {
		const mixed = `sed -i '' 's/v1\\.3\\.0/v1.6.0/g' website/index.html
grep -n x website/index.html
if grep -q badge site/index.html; then sed -i '' 's/v1\\.3\\.0/v1.6.0/g' site/index.html; fi`;
		expect(extractInplacePaths(mixed)).toEqual(["website/index.html", "site/index.html"]);
	});
});

describe("bash sed -i", () => {
	it("runs a lone sed -i as script_edit without an error", async () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-sed-"));
		dirs.push(dir);
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, "notes.txt"), "foo line\n");
		const tool = createBashToolDefinition(dir);
		const result = await tool.execute(
			"t1",
			{ command: "sed -i '' 's/foo/bar/g' notes.txt" },
			undefined,
			undefined,
			undefined as never,
		);
		expect(result.details?.scriptEdit?.engine).toBe("sed");
		expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("bar line\n");
		const text = result.content.map((part) => ("text" in part ? part.text : "")).join("");
		expect(text).toContain("script_edit");
		expect(text).not.toMatch(/Use script_edit/i);
		expect(text).not.toMatch(/read-before-write/i);
	});

	it("runs mixed sed -i plus grep without blocking the rest", async () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-sed-mix-"));
		dirs.push(dir);
		writeFileSync(join(dir, "notes.txt"), "foo line\n");
		const tool = createBashToolDefinition(dir);
		const result = await tool.execute(
			"t2",
			{
				command: "sed -i.bak 's/foo/bar/g' notes.txt\ngrep -n bar notes.txt",
			},
			undefined,
			undefined,
			undefined as never,
		);
		expect(result.details?.scriptEdit).toBeUndefined();
		expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("bar line\n");
		const text = result.content.map((part) => ("text" in part ? part.text : "")).join("");
		expect(text).toMatch(/bar line/);
		expect(text).not.toMatch(/Use script_edit/i);
	});
});
