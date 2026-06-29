import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.ts";
import { hashContent, loadPrologue } from "../src/core/prologue.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("prologue", () => {
	const tempRoots: string[] = [];

	afterEach(() => {
		for (const root of tempRoots) {
			if (existsSync(root)) {
				rmSync(root, { recursive: true, force: true });
			}
		}
		tempRoots.length = 0;
	});

	test("project prologue overrides global", () => {
		const root = join(tmpdir(), `trek-prologue-${Date.now()}`);
		tempRoots.push(root);
		const globalDir = join(root, "global", CONFIG_DIR_NAME);
		const projectDir = join(root, "project", CONFIG_DIR_NAME);
		mkdirSync(globalDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(globalDir, "prologue.md"), "global constitution");
		writeFileSync(join(projectDir, "prologue.md"), "project constitution");

		const previousHome = process.env.HOME;
		process.env.HOME = join(root, "global");
		try {
			const loaded = loadPrologue(join(root, "project"));
			expect(loaded.content).toBe("project constitution");
			expect(loaded.sources).toEqual([join(root, "project", CONFIG_DIR_NAME, "prologue.md")]);
		} finally {
			process.env.HOME = previousHome;
		}
	});

	test("falls back to global prologue when project file is missing", () => {
		const root = join(tmpdir(), `trek-prologue-global-${Date.now()}`);
		tempRoots.push(root);
		const globalDir = join(root, "home", CONFIG_DIR_NAME);
		mkdirSync(globalDir, { recursive: true });
		writeFileSync(join(globalDir, "prologue.md"), "global only");

		const previousHome = process.env.HOME;
		process.env.HOME = join(root, "home");
		try {
			const loaded = loadPrologue(join(root, "project"));
			expect(loaded.content).toBe("global only");
		} finally {
			process.env.HOME = previousHome;
		}
	});

	test("prologue appears in built system prompt", () => {
		const prompt = buildSystemPrompt({
			cwd: process.cwd(),
			contextFiles: [],
			skills: [],
			prologue: "Serve the user faithfully.",
		});

		expect(prompt).toContain("<prologue>\nServe the user faithfully.\n</prologue>");
	});

	test("hashContent is stable", () => {
		expect(hashContent("abc")).toBe(hashContent("abc"));
		expect(hashContent("abc")).not.toBe(hashContent("abcd"));
	});
});
