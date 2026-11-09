/**
 * Cross-file links for semantic memory (#221).
 * Links imports, test pairs, and doc↔code without extra kNN.
 */

export interface CrossFileLink {
	targetPath: string;
	linkType: "import" | "test-pair" | "doc-module";
}

/**
 * Extract import statements from source code.
 */
function extractImports(text: string, filePath: string): string[] {
	const imports: string[] = [];
	const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();

	if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
		// TypeScript/JavaScript imports
		// Match: import { x } from "module", import x from "module", require("module")
		const lines = text.split("\n");
		for (const line of lines) {
			const fromMatch = /from\s+['"]([^'"]+)['"]/.exec(line);
			const requireMatch = /require\s*\(['"]([^'"]+)['"]\)/.exec(line);
			const match = fromMatch || requireMatch;
			if (match?.[1]) {
				const importPath = match[1];
				if (!importPath.startsWith(".")) {
					// Skip relative imports
					imports.push(importPath);
				}
			}
		}
	} else if (ext === ".py") {
		// Python imports
		const lines = text.split("\n");
		for (const line of lines) {
			const importMatch = /(?:import|from)\s+([a-zA-Z0-9_.]+)/.exec(line);
			if (importMatch?.[1]) {
				imports.push(importMatch[1]);
			}
		}
	} else if (ext === ".go") {
		// Go imports
		const lines = text.split("\n");
		let inImportBlock = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("import (")) {
				inImportBlock = true;
				continue;
			}
			if (inImportBlock) {
				if (trimmed === ")") {
					inImportBlock = false;
					continue;
				}
				const lineMatch = /"([^"]+)"/.exec(trimmed);
				if (lineMatch?.[1]) {
					imports.push(lineMatch[1]);
				}
			} else {
				const singleImport = /^import\s+"([^"]+)"/.exec(trimmed);
				if (singleImport?.[1]) {
					imports.push(singleImport[1]);
				}
			}
		}
	} else if ([".rs", ".java", ".c", ".cpp", ".h"].includes(ext)) {
		// Rust/Java/C/C++ imports/includes
		const lines = text.split("\n");
		for (const line of lines) {
			const importMatch = /(?:use|import|#include)\s+[<"]?([^>;"]+)[>"]?/.exec(line);
			if (importMatch?.[1]) {
				imports.push(importMatch[1].trim());
			}
		}
	}

	return imports;
}

/**
 * Find test/source pair for a file path.
 */
function findTestPair(filePath: string): string | undefined {
	if (filePath.includes(".test.") || filePath.includes(".spec.") || filePath.includes("_test.")) {
		// This is a test file, find the source
		return filePath
			.replace(/\.test\./, ".")
			.replace(/\.spec\./, ".")
			.replace(/_test\./, ".");
	}

	// This is a source file, find the test
	const ext = filePath.slice(filePath.lastIndexOf("."));
	const base = filePath.slice(0, filePath.lastIndexOf("."));
	const candidates = [`${base}.test${ext}`, `${base}.spec${ext}`, `${base}_test${ext}`];

	// Return first candidate (existence check happens later)
	return candidates[0];
}

/**
 * Extract module name from doc heading.
 */
function extractModuleFromHeading(heading: string): string | undefined {
	// Match patterns like "## MyModule", "# MyModule API", etc.
	const match = /^#+\s+([A-Z][a-zA-Z0-9_]*)\b/.exec(heading);
	return match?.[1];
}

/**
 * Generate cross-file links for a chunk.
 */
export function generateCrossFileLinks(
	chunkText: string,
	filePath: string,
	chunkKind: string | undefined,
): CrossFileLink[] {
	const links: CrossFileLink[] = [];

	// Import links
	const imports = extractImports(chunkText, filePath);
	for (const imp of imports) {
		links.push({ targetPath: imp, linkType: "import" });
	}

	// Test pair link
	const pair = findTestPair(filePath);
	if (pair) {
		links.push({ targetPath: pair, linkType: "test-pair" });
	}

	// Doc heading ↔ module link
	if (chunkKind === "heading") {
		const firstLine = chunkText.split("\n")[0] || "";
		const module = extractModuleFromHeading(firstLine);
		if (module) {
			// Try to find a corresponding module file
			const candidates = [
				`${module}.ts`,
				`${module}.tsx`,
				`${module}.js`,
				`${module}.py`,
				`src/${module}.ts`,
				`lib/${module}.ts`,
			];
			for (const candidate of candidates) {
				links.push({ targetPath: candidate, linkType: "doc-module" });
			}
		}
	}

	return links;
}
