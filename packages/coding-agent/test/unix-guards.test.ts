/**
 * 0.19-C: refuse interactive editors, dd, find -delete; cap xargs -P.
 * Run: npx vitest --run test/unix-guards.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { inspectBashCommand, MAX_XARGS_PARALLEL } from "../src/core/tools/unix-guards.ts";

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

	it("redirects vim -Es and sed -i / ex to script_edit", () => {
		expect(inspectBashCommand("vim -Es -c wq notes.txt")).toMatchObject({ action: "redirect" });
		expect(inspectBashCommand("sed -i 's/foo/bar/g' notes.txt")).toMatchObject({ action: "redirect" });
		expect(inspectBashCommand("ex -s notes.txt")).toMatchObject({ action: "redirect" });
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
