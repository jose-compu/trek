/** Minimum repeated phrase length before a stream is treated as stuck. */
const MIN_PHRASE_CHARS = 48;
/** Consecutive identical suffixes required to trip the detector. */
const MIN_REPEATS = 3;
const MAX_PHRASE_CHARS = 400;
/** How many near-duplicate trailing blocks trip paraphrased babble. */
const MIN_NEAR_DUP_BLOCKS = 4;
/** Short completion/ask cues tiny models spam when looping. */
const BABBLE_CUES: RegExp[] = [
	/would you like to/gi,
	/no further action (?:needed|required)/gi,
	/the (?:edit|task|file|system) (?:was|is) (?:successful|complete|completed|done|final|ready|updated|applied|made)/gi,
	/\(no (?:further )?action (?:needed|required)\)/gi,
	/\(yes\)|\(end\)|\(exit\)/gi,
];

export const REPETITIVE_STREAM_ERROR = "Model entered a repetitive thinking loop; generation stopped.";

function normalizeForCompare(text: string): string {
	return text
		.toLowerCase()
		.replace(/[─━═\-_|]+/g, " ")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** True when `text` ends with the same phrase repeated at least `MIN_REPEATS` times. */
export function hasRepetitiveSuffix(text: string): boolean {
	const maxPhrase = Math.min(MAX_PHRASE_CHARS, Math.floor(text.length / MIN_REPEATS));
	if (maxPhrase < MIN_PHRASE_CHARS) {
		return false;
	}

	for (let period = MIN_PHRASE_CHARS; period <= maxPhrase; period++) {
		const suffix = text.slice(-period * MIN_REPEATS);
		const phrase = suffix.slice(0, period);
		if (phrase.trim().length < MIN_PHRASE_CHARS) {
			continue;
		}
		if (suffix === phrase.repeat(MIN_REPEATS)) {
			return true;
		}
	}

	return false;
}

/** Same idea after whitespace/punct collapse — catches lightly paraphrased clones. */
function hasNormalizedRepetitiveSuffix(text: string): boolean {
	const normalized = normalizeForCompare(text);
	return hasRepetitiveSuffix(normalized);
}

/** Tiny models invent fake wrap-ups and ask the same question forever. */
function hasCatchphraseSpam(text: string): boolean {
	for (const cue of BABBLE_CUES) {
		const matches = text.match(cue);
		if (matches && matches.length >= 4) {
			return true;
		}
	}
	return false;
}

/**
 * Near-duplicate trailing paragraphs (same opening skeleton, different filler).
 * Splits on blank lines / rule lines used as fake turn separators.
 */
function hasNearDuplicateBlocks(text: string): boolean {
	const blocks = text
		.split(/\n{2,}|\n[─━═\-_]{8,}\n/)
		.map((block) => normalizeForCompare(block))
		.filter((block) => block.length >= 36);
	if (blocks.length < MIN_NEAR_DUP_BLOCKS) {
		return false;
	}
	const tail = blocks.slice(-MIN_NEAR_DUP_BLOCKS);
	const prefixes = tail.map((block) => block.slice(0, 28));
	const first = prefixes[0]!;
	const samePrefix = prefixes.every((p) => p === first || sharePrefix(p, first, 18));
	if (samePrefix) {
		return true;
	}
	// Pairwise: ≥3 of the last 4 share a long common skeleton token run.
	let pairs = 0;
	for (let i = 0; i < tail.length; i++) {
		for (let j = i + 1; j < tail.length; j++) {
			if (jaccardBigrams(tail[i]!, tail[j]!) >= 0.72) {
				pairs += 1;
			}
		}
	}
	return pairs >= 3;
}

function sharePrefix(a: string, b: string, n: number): boolean {
	const len = Math.min(n, a.length, b.length);
	return len >= 12 && a.slice(0, len) === b.slice(0, len);
}

function jaccardBigrams(a: string, b: string): number {
	const A = bigrams(a);
	const B = bigrams(b);
	if (A.size === 0 || B.size === 0) {
		return 0;
	}
	let inter = 0;
	for (const g of A) {
		if (B.has(g)) {
			inter += 1;
		}
	}
	return inter / (A.size + B.size - inter);
}

function bigrams(text: string): Set<string> {
	const out = new Set<string>();
	const s = text.length >= 2 ? text : `${text} `;
	for (let i = 0; i < s.length - 1; i++) {
		out.add(s.slice(i, i + 2));
	}
	return out;
}

/** True when the stream is stuck in exact, normalized, catchphrase, or near-dup babble. */
export function isRepetitiveStreamText(text: string): boolean {
	if (text.length < MIN_PHRASE_CHARS * 2) {
		return false;
	}
	return (
		hasRepetitiveSuffix(text) ||
		hasNormalizedRepetitiveSuffix(text) ||
		hasCatchphraseSpam(text) ||
		hasNearDuplicateBlocks(text)
	);
}

/** Accumulates stream deltas and reports when the suffix starts looping. */
export class StreamRepetitionGuard {
	private buffer = "";

	append(delta: string): boolean {
		if (delta.length === 0) {
			return false;
		}
		this.buffer += delta;
		return isRepetitiveStreamText(this.buffer);
	}
}
