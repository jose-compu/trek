/**
 * Structure-aware chunking for semantic memory (v0.20.0).
 * Replaces naive line-window chunking with language-structure-first approach:
 * - Functions, classes, types stay atomic
 * - Markdown headings and fenced blocks stay atomic
 * - Signature overlap on body chunks
 * - No orphan closing braces
 */

export interface StructureChunk {
	text: string;
	lineStart: number;
	lineEnd: number;
	signature?: string;
	kind: "function" | "class" | "type" | "heading" | "fence" | "section" | "unknown";
	parentContext?: string;
	isLeaf?: boolean;
	hierarchyLevel?: number;
}

export interface ChunkOptions {
	filePath: string;
	maxLinesPerChunk?: number;
}

/**
 * Parse file into structure-aware chunks.
 * Language detection from file extension.
 */
export function chunkByStructure(content: string, options: ChunkOptions): StructureChunk[] {
	const ext = getExtension(options.filePath);

	if (ext === ".md" || ext === ".mdx") {
		return chunkMarkdown(content);
	}

	if (isCodeFile(ext)) {
		return chunkCode(content, ext);
	}

	return chunkFallback(content, options.maxLinesPerChunk ?? 50);
}

function getExtension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot > 0 ? path.slice(dot).toLowerCase() : "";
}

function isCodeFile(ext: string): boolean {
	return [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".rb", ".php"].includes(ext);
}

/**
 * Chunk Markdown by headings, keep fenced blocks atomic.
 */
function chunkMarkdown(content: string): StructureChunk[] {
	const lines = content.split("\n");
	const chunks: StructureChunk[] = [];
	let currentStart = 0;
	let inFence = false;
	let fenceStart = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || "";

		// Fenced code block
		if (line.trim().startsWith("```") || line.trim().startsWith("~~~")) {
			if (!inFence) {
				// Flush previous section before fence
				if (i > currentStart) {
					chunks.push({
						text: lines.slice(currentStart, i).join("\n"),
						lineStart: currentStart + 1,
						lineEnd: i,
						kind: "section",
					});
				}
				inFence = true;
				fenceStart = i;
			} else {
				// Closing fence - emit atomic fence chunk
				chunks.push({
					text: lines.slice(fenceStart, i + 1).join("\n"),
					lineStart: fenceStart + 1,
					lineEnd: i + 1,
					kind: "fence",
				});
				inFence = false;
				currentStart = i + 1;
			}
			continue;
		}

		if (inFence) continue;

		// ATX heading (# to ######)
		const atxMatch = /^(#{1,6})\s+(.+)$/.exec(line);
		if (atxMatch) {
			if (i > currentStart) {
				chunks.push({
					text: lines.slice(currentStart, i).join("\n"),
					lineStart: currentStart + 1,
					lineEnd: i,
					kind: "section",
				});
			}
			currentStart = i;
			continue;
		}

		// Setext heading (=== or ---)
		if (i > 0 && /^[=-]{3,}$/.test(line.trim())) {
			if (i - 1 > currentStart) {
				chunks.push({
					text: lines.slice(currentStart, i - 1).join("\n"),
					lineStart: currentStart + 1,
					lineEnd: i - 1,
					kind: "section",
				});
			}
			currentStart = i - 1;
		}
	}

	// Flush final section
	if (currentStart < lines.length) {
		const text = lines.slice(currentStart).join("\n");
		if (text.trim().length > 0) {
			chunks.push({
				text,
				lineStart: currentStart + 1,
				lineEnd: lines.length,
				kind: inFence ? "fence" : "section",
			});
		}
	}

	return chunks.filter((c) => c.text.trim().length > 0);
}

/**
 * Chunk code by functions, classes, types.
 * Basic regex-based parsing (lightweight, no tree-sitter).
 */
function chunkCode(content: string, ext: string): StructureChunk[] {
	const lines = content.split("\n");

	if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
		return chunkTypeScript(lines);
	}

	if (ext === ".py") {
		return chunkPython(lines);
	}

	// Other languages fall back to line-window
	return chunkFallback(content, 50);
}

function chunkTypeScript(lines: string[]): StructureChunk[] {
	const chunks: StructureChunk[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] || "";
		const trimmed = line.trim();

		// Skip empty lines
		if (trimmed.length === 0) {
			i++;
			continue;
		}

		// Function declaration
		const funcMatch = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/.exec(trimmed);
		const arrowMatch = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(trimmed);
		const methodMatch = /^(?:public|private|protected|static|async)?\s*(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/.exec(
			trimmed,
		);

		if (funcMatch || arrowMatch || methodMatch) {
			const match = (funcMatch || arrowMatch || methodMatch)!;
			const name = match[1] || "";
			const params = funcMatch ? funcMatch[3] || "" : arrowMatch ? arrowMatch[2] || "" : methodMatch?.[3] || "";
			const signature = `${name}(${params})`;

			const start = i;
			let braceDepth = 0;
			let foundBrace = false;

			// Find the full function body
			for (let j = i; j < lines.length; j++) {
				const l = lines[j] || "";
				for (const char of l) {
					if (char === "{") {
						braceDepth++;
						foundBrace = true;
					} else if (char === "}") {
						braceDepth--;
						if (foundBrace && braceDepth === 0) {
							// Found closing brace
							chunks.push({
								text: lines.slice(start, j + 1).join("\n"),
								lineStart: start + 1,
								lineEnd: j + 1,
								signature,
								kind: "function",
							});
							i = j + 1;
							break;
						}
					}
				}
				if (foundBrace && braceDepth === 0) break;
			}

			if (braceDepth > 0) {
				// Unclosed function, take rest of file
				chunks.push({
					text: lines.slice(start).join("\n"),
					lineStart: start + 1,
					lineEnd: lines.length,
					signature,
					kind: "function",
				});
				i = lines.length;
			}
			continue;
		}

		// Class declaration
		const classMatch = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(trimmed);
		if (classMatch) {
			const name = classMatch[1];
			const start = i;
			let braceDepth = 0;
			let foundBrace = false;

			for (let j = i; j < lines.length; j++) {
				const l = lines[j] || "";
				for (const char of l) {
					if (char === "{") {
						braceDepth++;
						foundBrace = true;
					} else if (char === "}") {
						braceDepth--;
						if (foundBrace && braceDepth === 0) {
							chunks.push({
								text: lines.slice(start, j + 1).join("\n"),
								lineStart: start + 1,
								lineEnd: j + 1,
								signature: name,
								kind: "class",
							});
							i = j + 1;
							break;
						}
					}
				}
				if (foundBrace && braceDepth === 0) break;
			}

			if (braceDepth > 0) {
				chunks.push({
					text: lines.slice(start).join("\n"),
					lineStart: start + 1,
					lineEnd: lines.length,
					signature: name,
					kind: "class",
				});
				i = lines.length;
			}
			continue;
		}

		// Type/Interface declaration
		const typeMatch = /^(?:export\s+)?(?:type|interface)\s+(\w+)/.exec(trimmed);
		if (typeMatch) {
			const name = typeMatch[1];
			const start = i;

			// For types without braces, just take the line
			if (!line.includes("{")) {
				chunks.push({
					text: line,
					lineStart: start + 1,
					lineEnd: start + 1,
					signature: name,
					kind: "type",
				});
				i++;
				continue;
			}

			let braceDepth = 0;
			let foundBrace = false;

			for (let j = i; j < lines.length; j++) {
				const l = lines[j] || "";
				for (const char of l) {
					if (char === "{") {
						braceDepth++;
						foundBrace = true;
					} else if (char === "}") {
						braceDepth--;
						if (foundBrace && braceDepth === 0) {
							chunks.push({
								text: lines.slice(start, j + 1).join("\n"),
								lineStart: start + 1,
								lineEnd: j + 1,
								signature: name,
								kind: "type",
							});
							i = j + 1;
							break;
						}
					}
				}
				if (foundBrace && braceDepth === 0) break;
			}

			if (braceDepth > 0) {
				chunks.push({
					text: lines.slice(start).join("\n"),
					lineStart: start + 1,
					lineEnd: lines.length,
					signature: name,
					kind: "type",
				});
				i = lines.length;
			}
			continue;
		}

		// Unmatched line - accumulate until next structure
		const start = i;
		i++;
		while (i < lines.length) {
			const nextLine = lines[i] || "";
			const nextTrimmed = nextLine.trim();
			if (nextTrimmed.length === 0) {
				i++;
				continue;
			}
			// Check if next line starts a structure
			if (
				/^(?:export\s+)?(?:async\s+)?function\s+\w+/.test(nextTrimmed) ||
				/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(nextTrimmed) ||
				/^(?:export\s+)?(?:abstract\s+)?class\s+\w+/.test(nextTrimmed) ||
				/^(?:export\s+)?(?:type|interface)\s+\w+/.test(nextTrimmed)
			) {
				break;
			}
			i++;
		}

		const text = lines.slice(start, i).join("\n").trim();
		if (text.length > 0) {
			chunks.push({
				text,
				lineStart: start + 1,
				lineEnd: i,
				kind: "unknown",
			});
		}
	}

	return chunks;
}

function chunkPython(lines: string[]): StructureChunk[] {
	const chunks: StructureChunk[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] || "";
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			i++;
			continue;
		}

		// Function or class
		const defMatch = /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/.exec(trimmed);
		const classMatch = /^class\s+(\w+)/.exec(trimmed);

		if (defMatch || classMatch) {
			const name = (defMatch || classMatch)![1];
			const params = defMatch ? defMatch[2] : undefined;
			const signature = params !== undefined ? `${name}(${params})` : name;
			const kind = defMatch ? "function" : "class";

			const start = i;
			const indent = line.length - line.trimStart().length;
			i++;

			// Find end of indented block
			while (i < lines.length) {
				const nextLine = lines[i] || "";
				const nextTrimmed = nextLine.trim();

				// Empty lines are part of the block
				if (nextTrimmed.length === 0) {
					i++;
					continue;
				}

				const nextIndent = nextLine.length - nextLine.trimStart().length;
				if (nextIndent <= indent) {
					// De-indented, block ended
					break;
				}

				i++;
			}

			chunks.push({
				text: lines.slice(start, i).join("\n"),
				lineStart: start + 1,
				lineEnd: i,
				signature,
				kind,
			});
			continue;
		}

		// Unmatched line
		const start = i;
		i++;
		while (i < lines.length) {
			const nextLine = lines[i] || "";
			const nextTrimmed = nextLine.trim();
			if (nextTrimmed.length === 0) {
				i++;
				continue;
			}
			if (/^(?:async\s+)?def\s+\w+/.test(nextTrimmed) || /^class\s+\w+/.test(nextTrimmed)) {
				break;
			}
			i++;
		}

		const text = lines.slice(start, i).join("\n").trim();
		if (text.length > 0) {
			chunks.push({
				text,
				lineStart: start + 1,
				lineEnd: i,
				kind: "unknown",
			});
		}
	}

	return chunks;
}

/**
 * Fallback for unsupported file types - simple line windows.
 */
function chunkFallback(content: string, maxLines: number): StructureChunk[] {
	const lines = content.split("\n");
	const chunks: StructureChunk[] = [];

	for (let i = 0; i < lines.length; i += maxLines) {
		const end = Math.min(i + maxLines, lines.length);
		const text = lines.slice(i, end).join("\n");
		if (text.trim().length > 0) {
			chunks.push({
				text,
				lineStart: i + 1,
				lineEnd: end,
				kind: "unknown",
			});
		}
	}

	return chunks;
}

/**
 * Extract signature for overlap on body embed.
 * Returns first line + docstring if present.
 */
export function extractSignatureOverlap(chunk: StructureChunk): string | undefined {
	if (!chunk.signature) return undefined;

	const lines = chunk.text.split("\n");
	if (lines.length === 0) return chunk.signature;

	// First line (signature)
	const firstLine = lines[0] || "";

	// Look for docstring in next few lines
	let docstring = "";
	for (let i = 1; i < Math.min(lines.length, 5); i++) {
		const line = lines[i] || "";
		const trimmed = line.trim();

		// JSDoc style
		if (trimmed.startsWith("/**") || trimmed.startsWith("*")) {
			const cleaned = trimmed
				.replace(/^\/?\*+\s?/, "")
				.replace(/\*+\/$/, "")
				.trim();
			if (cleaned.length > 0 && !cleaned.startsWith("@")) {
				docstring = cleaned;
				break;
			}
		}

		// Python docstring
		if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
			docstring = trimmed
				.replace(/^["']{3}/, "")
				.replace(/["']{3}$/, "")
				.trim();
			break;
		}
	}

	return docstring.length > 0 ? `${firstLine}\n${docstring}` : firstLine;
}
