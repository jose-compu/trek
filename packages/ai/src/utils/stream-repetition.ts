/** Minimum repeated phrase length before a stream is treated as stuck. */
const MIN_PHRASE_CHARS = 64;
/** Consecutive identical suffixes required to trip the detector. */
const MIN_REPEATS = 3;
const MAX_PHRASE_CHARS = 400;

export const REPETITIVE_STREAM_ERROR = "Model entered a repetitive thinking loop; generation stopped.";

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

/** Accumulates stream deltas and reports when the suffix starts looping. */
export class StreamRepetitionGuard {
	private buffer = "";

	append(delta: string): boolean {
		if (delta.length === 0) {
			return false;
		}
		this.buffer += delta;
		return hasRepetitiveSuffix(this.buffer);
	}
}
