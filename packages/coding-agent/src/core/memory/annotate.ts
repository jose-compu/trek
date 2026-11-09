/**
 * Situating headers from logosdb-mcp-server 1.3.0.
 * The embedder sees the header. The stored row keeps the raw body.
 */

import { buildSituatingHeader, embedTextForChunk } from "logosdb-mcp-server/dist/chunk-context.js";
import { type Chunk, resolveChunkMode } from "logosdb-mcp-server/dist/chunker.js";

export type MemoryKind = "lesson" | "file" | "turn" | "thinking" | "handoff";

export interface AnnotatedRow {
	embed: string;
	stored: string;
	kind: MemoryKind;
}

export function annotateLesson(
	text: string,
	tag: string | undefined,
	layer: "session" | "project" | "global" = "project",
	key?: string,
): AnnotatedRow {
	const tags: Record<string, string> = { layer, kind: "lesson" };
	if (tag) tags.tag = tag;
	if (key) tags.key = key;
	const chunk: Chunk = { text, offset: 0 };
	const embed = embedTextForChunk(
		"header",
		{
			filePath: "lesson",
			chunkIndex: 0,
			chunkCount: 1,
			chunk,
			resolvedMode: "legacy",
			namespace: layer,
			tags,
		},
		text,
	);
	const tagLine = tag ? `[tag:${tag}]` : "";
	const keyLine = key ? `[key:${key}]` : "";
	return { embed, stored: `[kind:lesson]${tagLine}${keyLine}\n${text}`, kind: "lesson" };
}

export function lessonKeyOf(stored: string): string | undefined {
	return /\[key:([^\]]+)\]/.exec(stored)?.[1];
}

export function annotateFile(relPath: string, chunk: Chunk, index: number, count: number): AnnotatedRow {
	const resolvedMode = resolveChunkMode({ mode: "auto", filePath: relPath });
	const embed = embedTextForChunk(
		"header",
		{
			filePath: relPath,
			chunkIndex: index,
			chunkCount: count,
			chunk,
			resolvedMode,
			namespace: "project",
			tags: { layer: "project", kind: "file" },
		},
		chunk.text,
	);
	const loc =
		chunk.lineStart != null && chunk.lineEnd != null
			? `lines:${chunk.lineStart}-${chunk.lineEnd}`
			: `offset:${chunk.offset}`;
	return {
		embed,
		stored: `[kind:file][file:${relPath}][${loc}]\n${chunk.text}`,
		kind: "file",
	};
}

export function annotateTurn(text: string): AnnotatedRow {
	const chunk: Chunk = { text, offset: 0 };
	const embed = embedTextForChunk(
		"header",
		{
			filePath: "session-turn",
			chunkIndex: 0,
			chunkCount: 1,
			chunk,
			resolvedMode: "legacy",
			namespace: "session",
			tags: { layer: "session", kind: "turn" },
		},
		text,
	);
	return { embed, stored: `[kind:turn]\n${text}`, kind: "turn" };
}

export function annotateThinking(excerpt: string, question: string): AnnotatedRow {
	const chunk: Chunk = { text: excerpt, offset: 0 };
	const header = buildSituatingHeader({
		filePath: "session-turn",
		chunkIndex: 0,
		chunkCount: 1,
		chunk,
		resolvedMode: "legacy",
		namespace: "session",
		tags: { layer: "session", kind: "thinking" },
	});
	const q = question.slice(0, 120);
	return {
		embed: `${header}\nQ: ${q}\n\n${excerpt}`,
		stored: `[kind:thinking]\n${excerpt}`,
		kind: "thinking",
	};
}

export function annotateHandoff(text: string): AnnotatedRow {
	const chunk: Chunk = { text, offset: 0 };
	const embed = embedTextForChunk(
		"header",
		{
			filePath: "session-handoff",
			chunkIndex: 0,
			chunkCount: 1,
			chunk,
			resolvedMode: "legacy",
			namespace: "session",
			tags: { layer: "session", kind: "handoff" },
		},
		text,
	);
	return { embed, stored: `[kind:handoff]\n${text}`, kind: "handoff" };
}

export function kindOf(stored: string): MemoryKind | "note" {
	const match = /^\[kind:(lesson|file|turn|thinking|handoff)\]/.exec(stored);
	return match ? (match[1] as MemoryKind) : "note";
}
