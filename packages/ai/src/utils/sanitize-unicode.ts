/**
 * Removes unpaired Unicode surrogate characters from a string.
 *
 * Unpaired surrogates (high surrogates 0xD800-0xDBFF without matching low surrogates 0xDC00-0xDFFF,
 * or vice versa) cause JSON serialization errors in many API providers.
 *
 * Valid emoji and other characters outside the Basic Multilingual Plane use properly paired
 * surrogates and will NOT be affected by this function.
 *
 * @param text - The text to sanitize
 * @returns The sanitized text with unpaired surrogates removed
 *
 * @example
 * // Valid emoji (properly paired surrogates) are preserved
 * sanitizeSurrogates("Hello 🙈 World") // => "Hello 🙈 World"
 *
 * // Unpaired high surrogate is removed
 * const unpaired = String.fromCharCode(0xD83D); // high surrogate without low
 * sanitizeSurrogates(`Text ${unpaired} here`) // => "Text  here"
 */
export function sanitizeSurrogates(text: string): string {
	// Replace unpaired high surrogates (0xD800-0xDBFF not followed by low surrogate)
	// Replace unpaired low surrogates (0xDC00-0xDFFF not preceded by high surrogate)
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/**
 * Strip characters that break provider JSON / tokenizers (NUL, other C0 besides tab/LF/CR).
 * Keeps valid emoji. Use this on complete strings, not streaming deltas.
 */
export function sanitizeProviderText(text: string): string {
	return sanitizeSurrogates(text)
		.replace(/\u0000/g, "")
		.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function sanitizeJsonValue(value: unknown): unknown {
	if (typeof value === "string") {
		return sanitizeProviderText(value);
	}
	if (Array.isArray(value)) {
		return value.map(sanitizeJsonValue);
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(record)) {
			out[sanitizeProviderText(key)] = sanitizeJsonValue(nested);
		}
		return out;
	}
	return value;
}
