/**
 * Hierarchical chunking for semantic memory (#218).
 * Each leaf has a parent summary chunk for contextual recall.
 */

import type { StructureChunk } from "./structure-chunker.ts";

export interface HierarchicalChunk extends StructureChunk {
	chunkId: string;
	parentId?: string;
	isParent: boolean;
}

/**
 * Generate hierarchical chunks from structure chunks.
 * Each leaf gets a corresponding parent summary chunk.
 */
export function generateHierarchy(chunks: StructureChunk[], filePath: string): HierarchicalChunk[] {
	const ext = getExtension(filePath);

	if (ext === ".md" || ext === ".mdx") {
		return generateMarkdownHierarchy(chunks, filePath);
	}

	if (isCodeFile(ext)) {
		return generateCodeHierarchy(chunks, filePath);
	}

	// Fallback: each chunk is both leaf and parent
	return chunks.map((chunk, index) => ({
		...chunk,
		chunkId: `${filePath}:${index}`,
		isParent: false,
	}));
}

function getExtension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot > 0 ? path.slice(dot).toLowerCase() : "";
}

function isCodeFile(ext: string): boolean {
	return [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h"].includes(ext);
}

/**
 * Generate hierarchy for code files: functions have class/file as parent.
 * For classes, we extract methods as separate leaf chunks.
 */
function generateCodeHierarchy(chunks: StructureChunk[], filePath: string): HierarchicalChunk[] {
	const result: HierarchicalChunk[] = [];

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		if (!chunk) continue;

		if (chunk.kind === "class") {
			// Create parent summary for the class
			const classId = `${filePath}:class:${chunk.signature || i}`;
			const classParent: HierarchicalChunk = {
				...chunk,
				chunkId: `${classId}:parent`,
				isParent: true,
			};
			result.push(classParent);

			// Extract methods from class as leaf chunks
			const methods = extractMethodsFromClass(chunk.text);
			for (let j = 0; j < methods.length; j++) {
				const method = methods[j];
				if (!method) continue;

				const leaf: HierarchicalChunk = {
					text: method.text,
					lineStart: chunk.lineStart + method.startOffset,
					lineEnd: chunk.lineStart + method.endOffset,
					signature: method.signature,
					kind: "function",
					chunkId: `${classId}:method:${method.signature}:leaf`,
					parentId: `${classId}:parent`,
					parentContext: `class ${chunk.signature}`,
					isParent: false,
				};
				result.push(leaf);
			}
		} else if (chunk.kind === "function") {
			// File-level function
			const fileParentId = `${filePath}:file:parent`;

			// Create file-level parent if it doesn't exist
			if (!result.some((r) => r.chunkId === fileParentId)) {
				const fileParent: HierarchicalChunk = {
					text: `// File: ${filePath.split("/").pop() || filePath}\n// Contains utility functions and exports`,
					lineStart: 1,
					lineEnd: 1,
					kind: "unknown",
					chunkId: fileParentId,
					isParent: true,
				};
				result.push(fileParent);
			}

			// Create leaf chunk for function
			const leaf: HierarchicalChunk = {
				...chunk,
				chunkId: `${filePath}:fn:${chunk.signature || i}:leaf`,
				parentId: fileParentId,
				parentContext: `file ${filePath.split("/").pop() || filePath}`,
				isParent: false,
			};
			result.push(leaf);
		} else {
			// Other structures (types, etc.) are standalone
			result.push({
				...chunk,
				chunkId: `${filePath}:${chunk.kind}:${i}`,
				isParent: false,
			});
		}
	}

	return result;
}

interface ExtractedMethod {
	text: string;
	signature: string;
	startOffset: number;
	endOffset: number;
}

/**
 * Extract methods from a class text.
 */
function extractMethodsFromClass(classText: string): ExtractedMethod[] {
	const methods: ExtractedMethod[] = [];
	const lines = classText.split("\n");

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i] || "";
		const trimmed = line.trim();

		// Match method signature
		const methodMatch = /^(?:public|private|protected|static|async)?\s*(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/.exec(
			trimmed,
		);
		if (methodMatch) {
			const name = methodMatch[1];
			const params = methodMatch[3] || "";
			const signature = `${name}(${params})`;

			// Find method body
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
							methods.push({
								text: lines.slice(start, j + 1).join("\n"),
								signature,
								startOffset: start,
								endOffset: j + 1,
							});
							i = j;
							break;
						}
					}
				}
				if (foundBrace && braceDepth === 0) break;
			}
		}
	}

	return methods;
}

/**
 * Generate hierarchy for Markdown: sections have heading breadcrumb as parent.
 */
function generateMarkdownHierarchy(chunks: StructureChunk[], filePath: string): HierarchicalChunk[] {
	const result: HierarchicalChunk[] = [];
	const headingStack: Array<{ level: number; text: string; id: string }> = [];

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		if (!chunk) continue;

		// Detect heading level
		const headingMatch = /^(#{1,6})\s+(.+)$/.exec(chunk.text.split("\n")[0] || "");
		if (headingMatch) {
			const level = headingMatch[1]!.length;
			const text = headingMatch[2]!.trim();

			// Pop headings of equal or higher level
			while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
				headingStack.pop();
			}

			// Build breadcrumb from stack
			const breadcrumb = headingStack.map((h) => h.text).join(" > ");

			const headingId = `${filePath}:heading:${text}:${level}`;
			headingStack.push({ level, text, id: headingId });

			// Create parent chunk (the heading itself)
			const parent: HierarchicalChunk = {
				text: breadcrumb.length > 0 ? `${breadcrumb} > ${text}` : text,
				lineStart: chunk.lineStart,
				lineEnd: chunk.lineStart,
				kind: "heading",
				chunkId: `${headingId}:parent`,
				isParent: true,
			};
			result.push(parent);

			// Create leaf chunk (the content under the heading)
			const contentLines = chunk.text.split("\n").slice(1).join("\n").trim();
			if (contentLines.length > 0) {
				const leaf: HierarchicalChunk = {
					text: contentLines,
					lineStart: chunk.lineStart + 1,
					lineEnd: chunk.lineEnd,
					kind: "section",
					chunkId: `${headingId}:leaf`,
					parentId: `${headingId}:parent`,
					parentContext: breadcrumb.length > 0 ? `${breadcrumb} > ${text}` : text,
					isParent: false,
				};
				result.push(leaf);
			}
		} else if (chunk.kind === "fence") {
			// Fenced blocks are children of current heading
			const parentId = headingStack.length > 0 ? `${headingStack[headingStack.length - 1]!.id}:parent` : undefined;
			const breadcrumb = headingStack.map((h) => h.text).join(" > ");

			result.push({
				...chunk,
				chunkId: `${filePath}:fence:${i}`,
				parentId,
				parentContext: breadcrumb,
				isParent: false,
			});
		} else {
			// Other content
			const parentId = headingStack.length > 0 ? `${headingStack[headingStack.length - 1]!.id}:parent` : undefined;

			result.push({
				...chunk,
				chunkId: `${filePath}:section:${i}`,
				parentId,
				isParent: false,
			});
		}
	}

	return result;
}
