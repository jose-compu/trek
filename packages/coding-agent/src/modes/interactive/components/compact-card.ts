/** Compact tool/thinking cards: header + optional 0–3 line tail viewport. */

export const COMPACT_VIEWPORT_LINES = 3;

const ANSI_SGR = /\x1b\[[0-9;]*m/g;
const OSC133 = /\x1b\]133;[ABC]\x07/g;

export function visibleCardText(line: string): string {
	return line.replace(ANSI_SGR, "").replace(OSC133, "").trim();
}

/**
 * Collapse a rendered card to 1–4 lines: the first visible line (type + cmd)
 * plus the last `viewport` content lines. Empty viewport → header only.
 * Leading and trailing blank lines are dropped so unused space is not reserved.
 */
export function compactCardLines(lines: readonly string[], viewport = COMPACT_VIEWPORT_LINES): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && visibleCardText(lines[start] ?? "") === "") {
		start++;
	}
	while (end > start && visibleCardText(lines[end - 1] ?? "") === "") {
		end--;
	}
	if (start >= end) {
		return [];
	}
	const header = lines[start] ?? "";
	let restStart = start + 1;
	while (restStart < end && visibleCardText(lines[restStart] ?? "") === "") {
		restStart++;
	}
	if (restStart >= end) {
		return [header];
	}
	const rest = lines.slice(restStart, end);
	if (rest.length <= viewport) {
		return [header, ...rest];
	}
	return [header, ...rest.slice(-viewport)];
}

/** Last `viewport` non-empty lines of a thinking / output blob. Empty → []. */
export function compactViewportLines(text: string, viewport = COMPACT_VIEWPORT_LINES): string[] {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return [];
	}
	return lines.slice(-viewport);
}
