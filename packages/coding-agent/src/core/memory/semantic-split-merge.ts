/**
 * Semantic split and merge for chunking (#219).
 * Cut at topic boundaries, merge orphans.
 */

export interface SemanticChunk {
	text: string;
	lineStart?: number;
	lineEnd?: number;
}

/**
 * Simple embedder interface for testing.
 */
export interface Embedder {
	embed(text: string): number[];
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dotProduct = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dotProduct += (a[i] || 0) * (b[i] || 0);
		magA += (a[i] || 0) ** 2;
		magB += (b[i] || 0) ** 2;
	}
	const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
	return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Count tokens (rough approximation: split on whitespace).
 */
function countTokens(text: string): number {
	return text.trim().split(/\s+/).length;
}

/**
 * Split a chunk at topic boundaries where embedding similarity drops.
 * @param chunk - Input chunk to split
 * @param embedder - Embedder to compute sentence similarity
 * @param threshold - Similarity threshold below which to split (default 0.5)
 * @returns Array of split chunks
 */
export function semanticSplit(chunk: SemanticChunk, embedder: Embedder, threshold = 0.5): SemanticChunk[] {
	const lines = chunk.text.split("\n");
	if (lines.length <= 1) return [chunk];

	const embeddings: number[][] = [];
	const validLines: string[] = [];

	// Embed each non-empty line
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length > 0) {
			embeddings.push(embedder.embed(trimmed));
			validLines.push(line);
		}
	}

	if (embeddings.length <= 1) return [chunk];

	// Find split points where similarity drops
	const splitIndices: number[] = [0];
	for (let i = 1; i < embeddings.length; i++) {
		const prev = embeddings[i - 1];
		const curr = embeddings[i];
		if (prev && curr) {
			const similarity = cosineSimilarity(prev, curr);
			if (similarity < threshold) {
				splitIndices.push(i);
			}
		}
	}
	splitIndices.push(embeddings.length);

	// Build chunks from split points
	const result: SemanticChunk[] = [];
	for (let i = 0; i < splitIndices.length - 1; i++) {
		const start = splitIndices[i];
		const end = splitIndices[i + 1];
		if (start !== undefined && end !== undefined) {
			const chunkLines = validLines.slice(start, end);
			if (chunkLines.length > 0) {
				result.push({
					text: chunkLines.join("\n"),
					lineStart: chunk.lineStart ? chunk.lineStart + start : undefined,
					lineEnd: chunk.lineStart ? chunk.lineStart + end - 1 : undefined,
				});
			}
		}
	}

	return result.length > 0 ? result : [chunk];
}

/**
 * Merge orphan chunks under the token threshold into neighbors.
 * @param chunks - Input chunks
 * @param minTokens - Minimum tokens per chunk (default 40)
 * @returns Merged chunks
 */
export function mergeOrphans(chunks: SemanticChunk[], minTokens = 40): SemanticChunk[] {
	if (chunks.length === 0) return [];
	if (chunks.length === 1) return chunks;

	const result: SemanticChunk[] = [];
	let i = 0;

	while (i < chunks.length) {
		const chunk = chunks[i];
		if (!chunk) {
			i++;
			continue;
		}

		const tokens = countTokens(chunk.text);

		if (tokens >= minTokens) {
			// Keep this chunk as-is
			result.push(chunk);
			i++;
		} else {
			// Orphan chunk, try to merge with neighbor
			const prev = result[result.length - 1];
			const next = chunks[i + 1];

			if (prev && !next) {
				// Last chunk is orphan, merge with previous
				result[result.length - 1] = {
					text: `${prev.text}\n${chunk.text}`,
					lineStart: prev.lineStart,
					lineEnd: chunk.lineEnd,
				};
				i++;
			} else if (!prev && next) {
				// First chunk is orphan, merge with next
				const merged = {
					text: `${chunk.text}\n${next.text}`,
					lineStart: chunk.lineStart,
					lineEnd: next.lineEnd,
				};
				result.push(merged);
				i += 2;
			} else if (prev && next) {
				// Middle orphan, merge with smaller neighbor
				const prevTokens = countTokens(prev.text);
				const nextTokens = countTokens(next.text);

				if (prevTokens <= nextTokens) {
					// Merge with previous
					result[result.length - 1] = {
						text: `${prev.text}\n${chunk.text}`,
						lineStart: prev.lineStart,
						lineEnd: chunk.lineEnd,
					};
					i++;
				} else {
					// Merge with next
					const merged = {
						text: `${chunk.text}\n${next.text}`,
						lineStart: chunk.lineStart,
						lineEnd: next.lineEnd,
					};
					result.push(merged);
					i += 2;
				}
			} else {
				// Shouldn't happen, but keep the chunk
				result.push(chunk);
				i++;
			}
		}
	}

	return result;
}
