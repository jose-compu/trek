/**
 * Local memory on LogosDB 1.1.0 with annotated chunks.
 * Run: npx vitest --run test/memory.test.ts --reporter=verbose
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Embedder, fakeEmbedder } from "../src/core/memory/embedder.ts";
import { isIndexableProject } from "../src/core/memory/index-files.ts";
import { type MemoryHit, MemoryManager, selectInjection } from "../src/core/memory/manager.ts";
import { shouldConstructCrossEncoder } from "../src/core/memory/rerank.ts";
import { captureTurn } from "../src/core/memory/turns.ts";
import type { MemorySettings } from "../src/core/settings-manager.ts";
import { formatRecallDisplay } from "../src/core/tools/memory.ts";
import type { Theme, ThemeColor } from "../src/modes/interactive/theme/theme.ts";

const dirs: string[] = [];

function project(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), `trek-mem-${name}-`));
	dirs.push(dir);
	mkdirSync(join(dir, ".git"));
	writeFileSync(join(dir, "package.json"), "{}\n");
	writeFileSync(join(dir, ".gitignore"), "secret.txt\n");
	return dir;
}

function settings(extra: Partial<MemorySettings> = {}): Required<MemorySettings> {
	return { enabled: true, session: true, project: true, global: false, topK: 5, ...extra };
}

function manager(
	cwd: string,
	sessionId: string,
	embedder: Embedder = fakeEmbedder(),
	extra: Partial<MemorySettings> = {},
) {
	return new MemoryManager({
		cwd,
		sessionId,
		getSettings: () => settings(extra),
		embedder,
		globalRoot: join(cwd, "global-memory"),
		debounceMs: 40,
	});
}

afterEach(() => {
	while (dirs.length > 0) {
		const dir = dirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("memory layers", () => {
	it("recalls a project lesson from a new session and hides session scratch", async () => {
		const cwd = project("lesson");
		const first = manager(cwd, "session-1");
		const stored = await first.remember("The billing export must stay in integer cents", "billing");
		expect(stored).toMatch(/^stored project:/);
		await first.recordTurn(
			[
				{ role: "user", content: [{ type: "text", text: "How do we bill?" }] },
				{ role: "assistant", content: [{ type: "text", text: "Use integer cents." }] },
			] as never,
			cwd,
		);
		await first.recordHandoff(cwd);
		first.close();

		const second = manager(cwd, "session-2");
		const hits = await second.recall("billing export cents");
		expect(hits.some((hit) => hit.kind === "lesson" && hit.text.includes("integer cents"))).toBe(true);
		expect(hits.some((hit) => hit.text.includes("How do we bill"))).toBe(false);
		expect(hits.some((hit) => hit.kind === "handoff")).toBe(false);
		second.close();

		const other = manager(project("other"), "session-3");
		const leaked = await other.recall("billing export cents");
		expect(leaked.some((hit) => hit.text.includes("integer cents"))).toBe(false);
		other.close();
	});

	it("embeds a situating header and stores the raw chunk", async () => {
		const cwd = project("chunk");
		mkdirSync(join(cwd, "src"));
		const body = "export function loadSettings() {\n  return 1;\n}\n";
		writeFileSync(join(cwd, "src", "foo.ts"), body);
		const embedder = fakeEmbedder();
		const mem = manager(cwd, "s", embedder);
		await mem.indexFile(join(cwd, "src", "foo.ts"));
		const embedded = embedder.calls.find((text) => text.includes("loadSettings"));
		expect(embedded).toBeTruthy();
		expect(embedded).toContain("File: src/foo.ts");
		expect(embedded).toContain("lines ");
		expect(embedded).toContain("kind=file");
		const hits = await mem.recall("loadSettings");
		expect(hits[0]?.text).toContain("return 1;");
		expect(hits[0]?.text).not.toContain("kind=file");
		expect(hits[0]?.text.endsWith(body.trim()) || hits[0]?.text.includes(body.trim())).toBe(true);
		mem.close();
	});

	it("replaces an indexed file after the debounce", async () => {
		const cwd = project("watch");
		const file = join(cwd, "note.txt");
		writeFileSync(file, "alpha token billing-old\n");
		const mem = manager(cwd, "s");
		await mem.start();
		let hits = await mem.recall("billing-old");
		expect(hits.some((hit) => hit.text.includes("billing-old"))).toBe(true);
		writeFileSync(file, "beta token billing-new\n");
		await waitFor(async () => {
			hits = await mem.recall("billing-new");
			return (
				hits.some((hit) => hit.text.includes("billing-new")) &&
				!hits.some((hit) => hit.text.includes("billing-old"))
			);
		});
		mem.close();
	});

	it("skips gitignored files, home, and slash", async () => {
		const cwd = project("ignore");
		writeFileSync(join(cwd, "secret.txt"), "secret token HIDDENPHRASE\n");
		writeFileSync(join(cwd, "visible.txt"), "visible token PUBLICPHRASE\n");
		const mem = manager(cwd, "s");
		await mem.indexProject();
		const hits = await mem.recall("HIDDENPHRASE PUBLICPHRASE");
		expect(hits.some((hit) => hit.text.includes("PUBLICPHRASE"))).toBe(true);
		expect(hits.some((hit) => hit.text.includes("HIDDENPHRASE"))).toBe(false);
		expect(isIndexableProject("/")).toBe(false);
		expect(isIndexableProject(homedir())).toBe(false);
		mem.close();
	});

	it("stores one annotated thinking row and drops redacted, short, and duplicate traces", async () => {
		const cwd = project("think");
		const embedder = fakeEmbedder();
		const mem = manager(cwd, "s", embedder);
		const question = "Why keep the billing export in integer cents?";
		const thinking = "The billing export must stay in integer cents because floating currency drifts.";
		await mem.recordTurn(
			[
				{ role: "user", content: [{ type: "text", text: question }] },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "too short" },
						{ type: "thinking", thinking: "secret", redacted: true, thinkingSignature: "opaque-signature" },
						{ type: "thinking", thinking },
						{ type: "text", text: "Use integer cents in the export." },
					],
				},
			] as never,
			cwd,
		);
		const header = embedder.calls.find((text) => text.includes("kind=thinking"));
		expect(header).toBeTruthy();
		expect(header).toContain("Q: Why keep the billing export");
		expect(header).not.toContain("opaque-signature");
		const hits = await mem.recall("integer cents reasoning");
		const row = hits.find((hit) => hit.kind === "thinking");
		expect(row?.text).toContain(thinking);
		expect(row?.text).not.toContain("opaque-signature");
		expect(row?.text.length).toBeLessThanOrEqual(thinking.length + 20);
		const turn = hits.find((hit) => hit.kind === "turn");
		expect(turn?.text).not.toContain(thinking);

		const same = captureTurn(
			[
				{ role: "user", content: "q" },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "x".repeat(50) },
						{ type: "text", text: "x".repeat(50) },
					],
				},
			] as never,
			cwd,
		);
		expect(same.thinking).toBeUndefined();
		mem.close();

		const later = manager(cwd, "other-session");
		const leaked = await later.recall(thinking);
		expect(leaked.some((hit) => hit.kind === "thinking")).toBe(false);
		later.close();
	});

	it("injects at most one thinking hit", () => {
		const lesson = hit("lesson", 0.9, "lesson");
		const file = hit("file", 0.4, "file");
		const strong = hit("thinking", 0.95, "think-strong");
		const weak = hit("thinking", 0.1, "think-weak");
		const picked = selectInjection([strong, lesson, weak, file], 2);
		expect(picked.filter((item) => item.kind === "thinking")).toHaveLength(1);
		expect(picked.some((item) => item.kind === "lesson")).toBe(true);
		const quiet = selectInjection([weak, lesson, file], 2);
		expect(quiet.some((item) => item.kind === "thinking")).toBe(false);
	});

	it("forgets the closest row and lets hybrid reorder a lexical hit", async () => {
		const cwd = project("hybrid");
		const embedder: Embedder = {
			dim: 4,
			async embed(text: string) {
				if (text.includes("LEX_ZEBRA")) return unit([0.1, 0.9, 0, 0]);
				if (text.includes("ANN_NEAR")) return unit([0.99, 0.01, 0, 0]);
				return unit([1, 0, 0, 0]);
			},
		};
		const mem = manager(cwd, "s", embedder);
		await mem.remember("ANN_NEAR vector neighbor without the animal");
		await mem.remember("LEX_ZEBRA the animal zebra is mentioned here");
		const hybrid = await mem.recall("zebra");
		const plain = await mem.recall("zebra", undefined, false);
		expect(hybrid[0]?.text).toContain("LEX_ZEBRA");
		expect(plain[0]?.text).toContain("ANN_NEAR");
		const removed = await mem.forget("zebra", "project");
		expect(removed).toMatch(/^deleted project:/);
		const after = await mem.recall("zebra");
		expect(after.some((hit) => hit.text.includes("LEX_ZEBRA"))).toBe(false);
		mem.close();
	});
});

describe("memory counts", () => {
	it("reports live chunks and does not create a missing global store", async () => {
		const cwd = project("counts");
		const mem = manager(cwd, "s");
		expect(mem.status()).toContain("chunks session=0 project=0 global=0");
		expect(existsSync(join(cwd, "global-memory"))).toBe(false);
		await mem.remember("keep the export in integer cents", "billing");
		await mem.recordTurn(
			[
				{ role: "user", content: [{ type: "text", text: "How do we bill?" }] },
				{ role: "assistant", content: [{ type: "text", text: "Use integer cents." }] },
			] as never,
			cwd,
		);
		expect(mem.status()).toContain("chunks session=1 project=1 global=0");
		expect(await mem.forget("integer cents", "project")).toMatch(/^deleted project:/);
		expect(mem.status()).toContain("chunks session=1 project=0 global=0");
		mem.close();
	});
});

describe("index paths", () => {
	it("indexes a file or folder on request and keeps a removal out of later reindexes", async () => {
		const cwd = project("pin");
		writeFileSync(join(cwd, "secret.txt"), "secret token HIDDENPHRASE\n");
		mkdirSync(join(cwd, "notes"));
		writeFileSync(join(cwd, "notes", "a.txt"), "folder token ALPHA_NOTE\n");
		writeFileSync(join(cwd, "notes", "b.txt"), "folder token BETA_NOTE\n");
		const mem = manager(cwd, "s");
		await mem.indexProject();
		expect((await mem.recall("HIDDENPHRASE")).some((hit) => hit.text.includes("HIDDENPHRASE"))).toBe(false);

		expect(await mem.addIndexedPath("secret.txt")).toMatch(/^indexed 1 secret.txt/);
		expect(await mem.addIndexedPath("notes")).toMatch(/^indexed 2 notes/);
		expect((await mem.recall("HIDDENPHRASE")).some((hit) => hit.text.includes("HIDDENPHRASE"))).toBe(true);
		expect((await mem.recall("ALPHA_NOTE")).some((hit) => hit.text.includes("ALPHA_NOTE"))).toBe(true);
		expect(mem.status()).toContain("include: notes, secret.txt");

		expect(await mem.removeIndexedPath("notes")).toMatch(/^removed notes chunks=/);
		expect((await mem.recall("ALPHA_NOTE")).some((hit) => hit.text.includes("ALPHA_NOTE"))).toBe(false);
		expect((await mem.recall("BETA_NOTE")).some((hit) => hit.text.includes("BETA_NOTE"))).toBe(false);
		expect((await mem.recall("HIDDENPHRASE")).some((hit) => hit.text.includes("HIDDENPHRASE"))).toBe(true);
		expect(mem.status()).toContain("exclude: notes");

		await mem.indexProject();
		expect((await mem.recall("ALPHA_NOTE")).some((hit) => hit.text.includes("ALPHA_NOTE"))).toBe(false);
		expect((await mem.recall("HIDDENPHRASE")).some((hit) => hit.text.includes("HIDDENPHRASE"))).toBe(true);
		expect(await mem.addIndexedPath("../outside")).toBe("path must stay inside the project");
		expect(await mem.removeIndexedPath(".trek/memory")).toBe("that path is not indexed");
		mem.close();
	});
});

describe("memory disabled", () => {
	it("skips embeddings and indexing when memory is off or every layer is off", async () => {
		const cwd = project("off");
		writeFileSync(join(cwd, "note.txt"), "UNIQUEOFFTOKEN\n");
		const embedder = fakeEmbedder();
		const mem = manager(cwd, "s", embedder, { enabled: false });
		expect(await mem.remember("a lesson worth keeping")).toBe("memory is off");
		expect(await mem.recall("lesson")).toEqual([]);
		await mem.start();
		await mem.indexFile(join(cwd, "note.txt"));
		expect(embedder.calls).toEqual([]);
		expect(mem.status()).toBe("memory=off");
		mem.close();

		const layersOff = manager(cwd, "s2", embedder, { session: false, project: false, global: false });
		expect(await layersOff.remember("another lesson")).toBe("memory is off");
		expect(embedder.calls).toEqual([]);
		layersOff.close();
	});
});

describe("rerank policy", () => {
	it("constructs a reranker for every mode and suite, and calls it on recall", async () => {
		expect(shouldConstructCrossEncoder({ effectiveMode: "local", suite: "mistral" })).toBe(true);
		expect(shouldConstructCrossEncoder({ effectiveMode: "local", suite: "qwen" })).toBe(true);
		expect(shouldConstructCrossEncoder({ effectiveMode: "local", suite: "lfm" })).toBe(true);
		expect(shouldConstructCrossEncoder({ effectiveMode: "api", suite: "mistral" })).toBe(true);
		expect(shouldConstructCrossEncoder({ effectiveMode: "hybrid", suite: "lfm" })).toBe(true);

		const cwd = project("rerank");
		const calls: string[][] = [];
		const reranker = {
			async rerank(_query: string, documents: string[]) {
				calls.push(documents);
				return documents.map((_, index) => documents.length - 1 - index);
			},
		};
		const mem = new MemoryManager({
			cwd,
			sessionId: "s",
			getSettings: () => settings(),
			embedder: fakeEmbedder(),
			globalRoot: join(cwd, "global-memory"),
			reranker,
		});
		await mem.remember("alpha lesson about oats");
		await mem.remember("beta lesson about barley");
		await mem.recall("oats and barley");
		expect(calls.length).toBe(1);
		mem.close();
	});
});

describe("recall display", () => {
	it("colors the layer, kind, tag, and file span separately from the passage", () => {
		const marks: string[] = [];
		const theme = {
			fg(color: ThemeColor, text: string) {
				marks.push(color);
				return `{${color}}${text}`;
			},
		} as Theme;
		const painted = formatRecallDisplay(
			[
				"[project lesson] [kind:lesson][tag:ledger]",
				"the ledger row keeps debit and credit as separate cent integers.",
				"[project file] [kind:file][file:src/billing.ts][lines:1-5]",
				"return Math.round(amount);",
			].join("\n"),
			theme,
		);
		expect(painted).toContain("{success}project");
		expect(painted).toContain("{syntaxKeyword}lesson");
		expect(painted).toContain("{syntaxString}ledger");
		expect(painted).toContain("{mdLink}src/billing.ts");
		expect(painted).toContain("{syntaxNumber}1-5");
		expect(painted).toContain("{toolOutput}the ledger row keeps debit and credit as separate cent integers.");
		expect(painted).not.toContain("\u001b");
		expect(marks).toContain("success");
	});
});

function hit(kind: MemoryHit["kind"], score: number, text: string): MemoryHit {
	return { id: `${kind}:${score}`, layer: "project", kind, score, text };
}

function unit(values: number[]): number[] {
	const norm = Math.hypot(...values) || 1;
	return values.map((value) => value / norm);
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < 2000) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
	throw new Error("timed out waiting for the debounced index");
}
