/**
 * Tone changes wording. It does not change a law reason.
 * Off is the default.
 */

export type ToneProfile = "off" | "plain";

const LAW_MARK = /\(Law \d|blocked|Refusing to modify|forbidden by default|Halted by operator/i;

export function applyTone(text: string, profile: ToneProfile): string {
	if (profile === "off" || LAW_MARK.test(text)) return text;
	return text
		.replace(/\bI would be happy to\b/gi, "")
		.replace(/\bjust\b/gi, "")
		.replace(/\s{2,}/g, " ")
		.replace(/\s+([,.])/g, "$1")
		.trim();
}
