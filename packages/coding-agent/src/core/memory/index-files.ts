/**
 * Project file walk. Gitignore rules come from logosdb-mcp-server.
 * Home, `/`, and hidden dependency trees are not indexed.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chunk } from "logosdb-mcp-server/dist/chunker.js";
import {
	buildGitignoreContext,
	findGitRoot,
	isIgnoredByStack,
	maybePushLocalGitignore,
	type IgnoreFrame,
} from "logosdb-mcp-server/dist/gitignore-walker.js";
import { annotateFile } from "./annotate.ts";

const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "CMakeLists.txt", "Makefile", ".hg"];
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".trek", "coverage", ".next", "target"]);
const TEXT_EXT = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
	".java",
	".md",
	".txt",
	".json",
	".yaml",
	".yml",
	".toml",
	".sh",
	".lean",
	".css",
	".html",
	".c",
	".h",
	".cpp",
	".rb",
	".php",
]);

const MAX_BYTES = 200_000;

export function isIndexableProject(dir: string): boolean {
	if (!dir) return false;
	const resolved = dir;
	if (resolved === homedir() || resolved === "/" || resolved === sep) return false;
	if (resolved.split(sep).filter(Boolean).length < 2) return false;
	return MARKERS.some((marker) => existsSync(join(resolved, marker)));
}

export interface IndexedChunk {
	embed: string;
	stored: string;
	relPath: string;
}

export function chunksForFile(absPath: string, cwd: string): IndexedChunk[] {
	const relPath = relative(cwd, absPath).split(sep).join("/");
	let raw: string;
	try {
		const buf = readFileSync(absPath);
		if (buf.length > MAX_BYTES || buf.subarray(0, 8192).includes(0)) return [];
		raw = buf.toString("utf8");
	} catch {
		return [];
	}
	const parts = chunk(raw, { mode: "auto", filePath: relPath });
	return parts.map((part, index) => {
		const row = annotateFile(relPath, part, index, parts.length);
		return { embed: row.embed, stored: row.stored, relPath };
	});
}

export function listProjectFiles(cwd: string): string[] {
	if (!isIndexableProject(cwd)) return [];
	const gitRoot = findGitRoot(cwd, [cwd]);
	const stack: IgnoreFrame[] = gitRoot ? buildGitignoreContext(gitRoot).rootStack : [];
	const out: string[] = [];
	walk(cwd, stack, cwd, out);
	return out;
}

function walk(dir: string, stack: readonly IgnoreFrame[], cwd: string, out: string[]): void {
	const next = maybePushLocalGitignore([...stack], dir);
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const abs = join(dir, entry.name);
		const isDir = entry.isDirectory();
		if (isIgnoredByStack(next, abs, isDir)) continue;
		if (isDir) {
			walk(abs, next, cwd, out);
			continue;
		}
		if (!entry.isFile()) continue;
		if (!isTextName(entry.name)) continue;
		try {
			if (statSync(abs).size > MAX_BYTES) continue;
		} catch {
			continue;
		}
		out.push(abs);
	}
}

const BLOCKED = new Set([".git", "node_modules", ".trek", "dist"]);

export interface IndexPathLists {
	include: string[];
	exclude: string[];
}

export function indexPathsFile(cwd: string): string {
	return join(cwd, ".trek", "memory", "paths.json");
}

export function loadIndexPaths(cwd: string): IndexPathLists {
	try {
		const raw = JSON.parse(readFileSync(indexPathsFile(cwd), "utf8")) as { include?: unknown; exclude?: unknown };
		return { include: pathList(raw.include), exclude: pathList(raw.exclude) };
	} catch {
		return { include: [], exclude: [] };
	}
}

export function saveIndexPaths(cwd: string, lists: IndexPathLists): void {
	const file = indexPathsFile(cwd);
	mkdirSync(join(cwd, ".trek", "memory"), { recursive: true });
	writeFileSync(
		file,
		`${JSON.stringify({ include: uniquePaths(lists.include), exclude: uniquePaths(lists.exclude) }, null, 2)}\n`,
	);
}

/** A project-relative path, or an error when it leaves the project or enters a blocked directory. */
export function resolveProjectPath(cwd: string, input: string): { rel: string; abs: string } | { error: string } {
	const trimmed = input.trim();
	if (!trimmed) return { error: "path required" };
	const abs = resolve(cwd, trimmed);
	const rel = relative(cwd, abs);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		return { error: "path must stay inside the project" };
	}
	const parts = rel.split(sep);
	if (parts.some((part) => BLOCKED.has(part))) return { error: "that path is not indexed" };
	return { rel: parts.join("/"), abs };
}

export function coversPath(root: string, file: string): boolean {
	return file === root || file.startsWith(`${root}/`);
}

/** Exclude wins on a tie. A longer path wins over a shorter one. */
export function pathIsExcluded(rel: string, lists: IndexPathLists): boolean {
	let best: { path: string; exclude: boolean } | undefined;
	for (const path of lists.include) {
		if (coversPath(path, rel) && (!best || path.length > best.path.length)) best = { path, exclude: false };
	}
	for (const path of lists.exclude) {
		if (coversPath(path, rel) && (!best || path.length >= best.path.length)) best = { path, exclude: true };
	}
	return best?.exclude === true;
}

/** Text files under an explicit file or folder. Gitignore does not apply. */
export function filesAt(cwd: string, abs: string): string[] {
	let st: ReturnType<typeof statSync>;
	try {
		st = statSync(abs);
	} catch {
		return [];
	}
	if (st.isFile()) {
		if (!isTextName(basename(abs)) || st.size > MAX_BYTES) return [];
		try {
			if (readFileSync(abs).subarray(0, 8192).includes(0)) return [];
		} catch {
			return [];
		}
		return [abs];
	}
	if (!st.isDirectory()) return [];
	const out: string[] = [];
	walk(abs, [], cwd, out);
	return out;
}

function pathList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return uniquePaths(value.filter((item): item is string => typeof item === "string"));
}

function uniquePaths(paths: string[]): string[] {
	return [...new Set(paths.map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")).filter(Boolean))].sort();
}

function isTextName(name: string): boolean {
	if (name.endsWith(".lock") || name === "package-lock.json" || name === "npm-shrinkwrap.json") return false;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return false;
	return TEXT_EXT.has(name.slice(dot).toLowerCase());
}
