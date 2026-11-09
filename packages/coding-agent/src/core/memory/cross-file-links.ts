/**
 * Cross-file links for semantic memory (#221).
 * Links imports, test pairs, and doc↔code without a second kNN.
 */

import { dirname, join, normalize, sep } from "node:path";

export interface CrossFileLink {
	targetPath: string;
	linkType: "import" | "test-pair" | "doc-module";
}

const LINK_MARKER = /\[links:(\[[\s\S]*?\])\]/;

const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Extract import statements from source code.
 * Relative imports are resolved against `filePath` into project-relative paths.
 */
function extractImports(text: string, filePath: string): string[] {
	const imports: string[] = [];
	const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

	if (JS_EXT.includes(ext)) {
		const lines = text.split("\n");
		for (const line of lines) {
			const fromMatch = /from\s+['"]([^'"]+)['"]/.exec(line);
			const requireMatch = /require\s*\(['"]([^'"]+)['"]\)/.exec(line);
			const match = fromMatch || requireMatch;
			if (!match?.[1]) continue;
			const importPath = match[1];
			if (importPath.startsWith(".")) {
				const resolved = resolveRelativeImport(filePath, importPath);
				if (resolved) imports.push(resolved);
			}
			// Non-relative package ids are not project paths; skip for neighbor recall.
		}
	} else if (ext === ".py") {
		const lines = text.split("\n");
		for (const line of lines) {
			const fromMatch = /^from\s+(\.+[a-zA-Z0-9_.]*)\s+import\b/.exec(line.trim());
			if (fromMatch?.[1]) {
				const resolved = resolvePythonRelative(filePath, fromMatch[1]);
				if (resolved) imports.push(resolved);
			}
		}
	}

	return imports;
}

function resolveRelativeImport(filePath: string, importPath: string): string | undefined {
	const baseDir = dirname(filePath);
	const joined = normalize(join(baseDir, importPath)).split(sep).join("/");
	if (joined.startsWith("..")) return undefined;
	const withExt = JS_EXT.some((candidate) => joined.endsWith(candidate)) ? joined : `${joined}.ts`;
	return withExt.replace(/^\.\//, "");
}

function resolvePythonRelative(filePath: string, dotted: string): string | undefined {
	const ups = dotted.match(/^\.+/)?.[0].length ?? 0;
	if (ups === 0) return undefined;
	const parts = dirname(filePath).split("/");
	const climb = Math.max(ups - 1, 0);
	if (climb > parts.length) return undefined;
	const root = parts.slice(0, parts.length - climb);
	const mod = dotted.slice(ups).replace(/\./g, "/");
	const joined = [...root, ...(mod ? [mod] : [])].join("/");
	return joined ? `${joined}.py` : undefined;
}

/**
 * Find test/source pair for a file path.
 */
function findTestPair(filePath: string): string | undefined {
	if (filePath.includes(".test.") || filePath.includes(".spec.") || filePath.includes("_test.")) {
		return filePath
			.replace(/\.test\./, ".")
			.replace(/\.spec\./, ".")
			.replace(/_test\./, ".");
	}

	const ext = filePath.slice(filePath.lastIndexOf("."));
	const base = filePath.slice(0, filePath.lastIndexOf("."));
	return `${base}.test${ext}`;
}

/**
 * Extract module name from doc heading.
 */
function extractModuleFromHeading(heading: string): string | undefined {
	const match = /^#+\s+([A-Z][a-zA-Z0-9_]*)\b/.exec(heading);
	return match?.[1];
}

/**
 * Generate cross-file links for a chunk.
 * When `knownPaths` is provided, only keep targets that exist in the index set.
 */
export function generateCrossFileLinks(
	chunkText: string,
	filePath: string,
	chunkKind: string | undefined,
	knownPaths?: ReadonlySet<string>,
): CrossFileLink[] {
	const links: CrossFileLink[] = [];
	const seen = new Set<string>();

	const push = (targetPath: string, linkType: CrossFileLink["linkType"]) => {
		const key = `${linkType}:${targetPath}`;
		if (seen.has(key)) return;
		if (knownPaths && !knownPaths.has(targetPath) && !matchKnown(knownPaths, targetPath)) return;
		const resolved = knownPaths ? resolveKnown(knownPaths, targetPath) : targetPath;
		if (!resolved) return;
		seen.add(`${linkType}:${resolved}`);
		links.push({ targetPath: resolved, linkType });
	};

	for (const imp of extractImports(chunkText, filePath)) {
		push(imp, "import");
	}

	const pair = findTestPair(filePath);
	if (pair) push(pair, "test-pair");

	if (chunkKind === "heading") {
		const firstLine = chunkText.split("\n")[0] || "";
		const module = extractModuleFromHeading(firstLine);
		if (module) {
			const candidates = [
				`${module}.ts`,
				`${module}.tsx`,
				`${module}.js`,
				`${module}.py`,
				`src/${module}.ts`,
				`lib/${module}.ts`,
			];
			for (const candidate of candidates) {
				if (!knownPaths || knownPaths.has(candidate) || matchKnown(knownPaths, candidate)) {
					push(candidate, "doc-module");
					break;
				}
			}
		}
	}

	return links;
}

function matchKnown(known: ReadonlySet<string>, target: string): boolean {
	if (known.has(target)) return true;
	const bare = target.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, "");
	for (const path of known) {
		if (path === target) return true;
		if (path.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, "") === bare) return true;
		if (path.endsWith(`/${target}`) || path.endsWith(`/${bare}.ts`)) return true;
	}
	return false;
}

function resolveKnown(known: ReadonlySet<string>, target: string): string | undefined {
	if (known.has(target)) return target;
	const bare = target.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, "");
	for (const path of known) {
		if (path === target) return path;
		if (path.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, "") === bare) return path;
		if (path.endsWith(`/${target}`) || path.endsWith(`/${bare}.ts`)) return path;
	}
	return undefined;
}

/** Parse `[links:…]` from a stored chunk row. */
export function parseCrossFileLinks(stored: string): CrossFileLink[] {
	const match = LINK_MARKER.exec(stored);
	if (!match?.[1]) return [];
	try {
		const parsed = JSON.parse(match[1]) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is CrossFileLink =>
				!!item &&
				typeof item === "object" &&
				typeof (item as CrossFileLink).targetPath === "string" &&
				((item as CrossFileLink).linkType === "import" ||
					(item as CrossFileLink).linkType === "test-pair" ||
					(item as CrossFileLink).linkType === "doc-module"),
		);
	} catch {
		return [];
	}
}
