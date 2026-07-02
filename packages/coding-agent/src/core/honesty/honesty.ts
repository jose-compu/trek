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
export const HONESTY_PROMPT_SECTION = `## Honesty protocol

End the FINAL message of every turn with this footer (after your normal answer):

<honesty>
confidence: high|medium|low
assumption: <one line per assumption you made without verifying it; write "none" if none>
unverified: <one line per factual claim not backed by tool evidence from this session; write "none" if none>
</honesty>

Rules:
- confidence reflects how certain you are that your work is correct and complete.
- Verify before assert: statements about files, commands, or system state must come from tool output you observed this session. Anything recalled from training or guessed belongs under "unverified".
- Repeat the "assumption:" and "unverified:" lines as needed, one item per line.`;

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

/** Remove the honesty footer from a message text (for display contexts that render it separately). */
export function stripHonestyFooter(text: string): string {
	return text.replace(FOOTER_PATTERN, "").trimEnd();
}
