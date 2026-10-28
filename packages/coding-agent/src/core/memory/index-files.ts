/**
 * Project file walk. Gitignore rules come from logosdb-mcp-server.
 * Home, `/`, and hidden dependency trees are not indexed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
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

function isTextName(name: string): boolean {
	if (name.endsWith(".lock") || name === "package-lock.json" || name === "npm-shrinkwrap.json") return false;
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return false;
	return TEXT_EXT.has(name.slice(dot).toLowerCase());
}
