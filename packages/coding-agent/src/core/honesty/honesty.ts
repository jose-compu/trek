/**
 * Honesty protocol (issue #4) + verify-before-assert (issue #6).
 * SPECS_SAFETY_HARNESS §13 item 4: structured output fields — confidence,
 * assumption ledger, and claims flagged as from-training/unverified.
 *
 * The model is instructed (system prompt section below) to end its final turn
 * message with an `<honesty>` footer. This module parses that footer into a
 * structured report so the session, tests, and future UI can consume it.
 */

export type ConfidenceLevel = "high" | "medium" | "low";

export interface HonestyReport {
	/** Whether an honesty footer was present in the message at all. */
	present: boolean;
	confidence?: ConfidenceLevel;
	/** Assumption ledger: assumptions made without verifying them this session. */
	assumptions: string[];
	/** Verify-before-assert: claims not backed by tool evidence (from training, unverified). */
	unverified: string[];
}

/** Opt out with TREK_HONESTY=0 (mirrors TREK_REFLECTIVE_LOOP). */
export function isHonestyProtocolEnabled(): boolean {
	return process.env.TREK_HONESTY !== "0" && process.env.TREK_HONESTY !== "false";
}

/** System prompt section instructing the model to emit the honesty footer. */
export const HONESTY_PROMPT_SECTION = `## Honesty

End the final message with exactly this block. No emoji. No other tag. Do not write confidence, assumptions, or task status in the answer.

<honesty>
confidence: medium
assumption: none
unverified: none
</honesty>

confidence is high, medium, or low.
assumption is one line each, or none.
unverified is one line each, or none.`;

const FOOTER_PATTERN = /<honesty>([\s\S]*?)<\/honesty>/i;

function isNone(value: string): boolean {
	const v = value.trim().toLowerCase();
	return v === "" || v === "none" || v === "n/a" || v === "-";
}

/** Parse the `<honesty>` footer out of an assistant message text. */
export function parseHonestyReport(text: string): HonestyReport {
	const match = FOOTER_PATTERN.exec(text);
	if (!match) {
		return { present: false, assumptions: [], unverified: [] };
	}

	const report: HonestyReport = { present: true, assumptions: [], unverified: [] };
	for (const rawLine of match[1].split("\n")) {
		const line = rawLine.trim().replace(/^[-*]\s*/, "");
		const colon = line.indexOf(":");
		if (colon === -1) {
			continue;
		}
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (key === "confidence") {
			const level = value.toLowerCase();
			if (level === "high" || level === "medium" || level === "low") {
				report.confidence = level;
			}
		} else if (key === "assumption" || key === "assumptions") {
			if (!isNone(value)) {
				report.assumptions.push(value);
			}
		} else if (key === "unverified" || key === "from_training_unverified") {
			if (!isNone(value)) {
				report.unverified.push(value);
			}
		}
	}
	return report;
}

const EMOJI = /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}|\u{200D})/u;

/** Trailing lines a small model invents instead of the fixed footer. */
function isHonestyChatterLine(line: string): boolean {
	const plain = line.trim();
	if (!plain) {
		return true;
	}
	if (plain.length > 180 && !EMOJI.test(plain)) {
		return false;
	}
	if (EMOJI.test(plain) && plain.length <= 180) {
		return true;
	}
	return (
		/^(high|medium|low)\b[.!:\s]/i.test(plain) ||
		/^(confidence|assumption|assumptions|unverified|footer)\b/i.test(plain) ||
		/\btask (is )?complet/i.test(plain) ||
		/^<\/?[a-z][^>]*>$/i.test(plain) ||
		/^(your (request|path|command|turn|success|final)|let me know|i'm here|i am here)\b/i.test(plain) ||
		/\b(let's|lets) (build|go|make|do|celebrate|proceed|open)\b/i.test(plain)
	);
}

/** Remove the honesty footer, including a tag the model has not closed yet. */
export function stripHonestyFooter(text: string): string {
	let next = text.replace(FOOTER_PATTERN, "");
	const open = next.toLowerCase().lastIndexOf("<honesty");
	if (open !== -1) {
		next = next.slice(0, open);
	}
	const lines = next.split("\n");
	while (lines.length > 0 && isHonestyChatterLine(lines[lines.length - 1] ?? "")) {
		lines.pop();
	}
	return lines.join("\n").trimEnd();
}

/** Fixed status line. The raw tag stays off screen. */
export function honestyDisplay(
	text: string,
): { confidence: ConfidenceLevel; headline: string; details: string[] } | undefined {
	const report = parseHonestyReport(text);
	if (!report.confidence) {
		return undefined;
	}
	const headline = `honesty confidence=${report.confidence} assumptions=${report.assumptions.length} unverified=${report.unverified.length}`;
	const details = [
		...report.assumptions.map((item) => `assumption: ${item}`),
		...report.unverified.map((item) => `unverified: ${item}`),
	];
	return { confidence: report.confidence, headline, details };
}

/** One display line when the footer has a real confidence. The raw tag stays off screen. */
export function honestyStatusLine(text: string): string | undefined {
	const display = honestyDisplay(text);
	if (!display) {
		return undefined;
	}
	return [display.headline, ...display.details].join("   ");
}
