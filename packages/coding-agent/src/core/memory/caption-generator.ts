/**
 * Deterministic intent caption generation for semantic memory (#220).
 * Captions are embedded (dual-channel) but not stored.
 * No live LLM required - extracts from docstrings, headings, first paragraphs.
 */

export interface StructureChunk {
	text: string;
	lineStart: number;
	lineEnd: number;
	signature?: string;
	kind: "function" | "class" | "type" | "heading" | "fence" | "section" | "unknown";
}

/**
 * Generate a deterministic intent caption for a chunk.
 * Returns a one-line summary describing what the code/section does.
 */
export function generateCaption(chunk: StructureChunk, filePath: string): string {
	const ext = getExtension(filePath);

	if (ext === ".md" || ext === ".mdx") {
		return generateMarkdownCaption(chunk, filePath);
	}

	if (isCodeFile(ext)) {
		return generateCodeCaption(chunk, filePath);
	}

	return generateFallbackCaption(chunk, filePath);
}

function getExtension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot > 0 ? path.slice(dot).toLowerCase() : "";
}

function isCodeFile(ext: string): boolean {
	return [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h"].includes(ext);
}

/**
 * Generate caption for code chunks from docstrings or signatures.
 */
function generateCodeCaption(chunk: StructureChunk, filePath: string): string {
	const lines = chunk.text.split("\n");

	// For functions/classes, extract docstring
	const docstring = extractDocstring(lines);
	if (docstring) {
		return `${filePath}: ${docstring}`;
	}

	// Use signature if available
	if (chunk.signature) {
		if (chunk.kind === "function") {
			return `${filePath}: function ${chunk.signature}`;
		}
		if (chunk.kind === "class") {
			return `${filePath}: class ${chunk.signature}`;
		}
		if (chunk.kind === "type") {
			return `${filePath}: type definition ${chunk.signature}`;
		}
	}

	// Fallback to first non-empty line
	const firstLine = lines.find((l) => l.trim().length > 0);
	if (firstLine) {
		const trimmed = firstLine.trim();
		return `${filePath}: ${trimmed.slice(0, 80)}`;
	}

	return `${filePath}: code section`;
}

/**
 * Extract docstring from code lines.
 */
function extractDocstring(lines: string[]): string | undefined {
	for (let i = 0; i < Math.min(lines.length, 10); i++) {
		const line = lines[i] || "";
		const trimmed = line.trim();

		// JSDoc style: /** ... */
		if (trimmed.startsWith("/**") || trimmed.startsWith("*")) {
			const doc = trimmed
				.replace(/^\/?\*+\s?/, "")
				.replace(/\*+\/$/, "")
				.trim();
			// Skip @tags
			if (doc.startsWith("@")) continue;
			if (doc.length > 0 && doc.length < 120) {
				return doc;
			}
		}

		// Python docstring: """...""" or '''...'''
		if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
			const doc = trimmed
				.replace(/^["']{3}/, "")
				.replace(/["']{3}$/, "")
				.trim();
			if (doc.length > 0 && doc.length < 120) {
				return doc;
			}
		}

		// Single-line comment: // ... or # ...
		if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
			const doc = trimmed
				.replace(/^\/\/\s?/, "")
				.replace(/^#\s?/, "")
				.trim();
			if (doc.length > 0 && doc.length < 120 && !doc.startsWith("@")) {
				return doc;
			}
		}
	}

	return undefined;
}

/**
 * Generate caption for Markdown chunks from headings or first paragraph.
 */
function generateMarkdownCaption(chunk: StructureChunk, filePath: string): string {
	const lines = chunk.text.split("\n");

	// For heading chunks, use the heading text
	if (chunk.kind === "heading") {
		const firstLine = lines[0] || "";
		const headingMatch = /^#{1,6}\s+(.+)$/.exec(firstLine);
		if (headingMatch) {
			return `${filePath}: ${headingMatch[1]?.trim()}`;
		}
	}

	// For sections, extract first paragraph
	const firstPara = extractFirstParagraph(lines);
	if (firstPara) {
		return `${filePath}: ${firstPara}`;
	}

	// For fenced blocks, indicate it's a code example
	if (chunk.kind === "fence") {
		const langMatch = /^```(\w+)/.exec(lines[0] || "");
		const lang = langMatch?.[1] || "code";
		return `${filePath}: ${lang} example`;
	}

	return `${filePath}: documentation section`;
}

/**
 * Extract first non-empty paragraph from Markdown.
 */
function extractFirstParagraph(lines: string[]): string | undefined {
	let paragraph = "";

	for (const line of lines) {
		const trimmed = line.trim();

		// Skip headings and empty lines at start
		if (trimmed.startsWith("#") || trimmed.length === 0) {
			if (paragraph.length > 0) break;
			continue;
		}

		// Skip code fences
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			break;
		}

		paragraph += (paragraph.length > 0 ? " " : "") + trimmed;

		// Stop at reasonable length
		if (paragraph.length > 100) {
			paragraph = paragraph.slice(0, 100);
			break;
		}
	}

	return paragraph.length > 0 ? paragraph : undefined;
}

/**
 * Fallback caption for unknown file types.
 */
function generateFallbackCaption(chunk: StructureChunk, filePath: string): string {
	const firstLine = chunk.text.split("\n").find((l) => l.trim().length > 0);
	if (firstLine) {
		const trimmed = firstLine.trim();
		return `${filePath}: ${trimmed.slice(0, 80)}`;
	}

	return `${filePath}: text section`;
}
