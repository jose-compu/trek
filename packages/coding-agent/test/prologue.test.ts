import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.ts";
import {
	getSealedPrologueSource,
	loadSealedConstitution,
	resetSealedConstitutionCache,
} from "../src/core/prologue/constitution.ts";
import { hashContent, loadPrologue } from "../src/core/prologue.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("prologue", () => {
	const tempRoots: string[] = [];
	let previousPrologueEnv: string | undefined;

	beforeEach(() => {
		previousPrologueEnv = process.env.TREK_PROLOGUE;
		delete process.env.TREK_PROLOGUE;
		resetSealedConstitutionCache();
	});

	afterEach(() => {
		for (const root of tempRoots) {
			if (existsSync(root)) {
				rmSync(root, { recursive: true, force: true });
			}
		}
		tempRoots.length = 0;
		if (previousPrologueEnv === undefined) {
			delete process.env.TREK_PROLOGUE;
		} else {
			process.env.TREK_PROLOGUE = previousPrologueEnv;
		}
		resetSealedConstitutionCache();
	});

	test("sealed constitution round-trips", () => {
		const text = loadSealedConstitution();
		expect(text.startsWith("---\nname: prologue-constitution")).toBe(true);
		expect(text).toContain("## Stop");
	});

	test("sealed constitution is always loaded", () => {
		const loaded = loadPrologue(process.cwd());
		expect(loaded.content?.startsWith("---\nname: prologue-constitution")).toBe(true);
		expect(loaded.sources[0]).toBe(getSealedPrologueSource());
	});

	test("TREK_PROLOGUE=0 disables sealed constitution", () => {
		process.env.TREK_PROLOGUE = "0";
		const loaded = loadPrologue(process.cwd());
		expect(loaded.content).toBeUndefined();
		expect(loaded.sources).toEqual([]);
	});

	test("project prologue overrides global", () => {
		process.env.TREK_PROLOGUE = "0";
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
		process.env.TREK_PROLOGUE = "0";
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
		const sealed = loadSealedConstitution();
		const prompt = buildSystemPrompt({
			cwd: process.cwd(),
			contextFiles: [],
			skills: [],
			prologue: sealed,
		});

		expect(prompt).toContain("<prologue>");
		expect(prompt).toContain("name: prologue-constitution");
		expect(prompt).toContain("## Stop");
	});

	test("hashContent is stable", () => {
		expect(hashContent("abc")).toBe(hashContent("abc"));
		expect(hashContent("abc")).not.toBe(hashContent("abcd"));
	});
});
