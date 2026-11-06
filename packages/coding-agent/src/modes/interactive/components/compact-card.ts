/** Compact tool/thinking cards: header + optional 0–3 line tail viewport. */

export const COMPACT_VIEWPORT_LINES = 3;

const ANSI_SGR = /\x1b\[[0-9;]*m/g;
const OSC133 = /\x1b\]133;[ABC]\x07/g;

export function visibleCardText(line: string): string {
	return line.replace(ANSI_SGR, "").replace(OSC133, "").trim();
}

const DURATION_LINE = /^(Took|Elapsed)\s+\d+\.\d+s$/;

export function isCompactDurationLine(line: string): boolean {
	return DURATION_LINE.test(visibleCardText(line));
}

function dropTrailingDuration(lines: string[]): string[] {
	const next = [...lines];
	while (next.length > 0 && isCompactDurationLine(next[next.length - 1] ?? "")) {
		next.pop();
		while (next.length > 0 && visibleCardText(next[next.length - 1] ?? "") === "") {
			next.pop();
		}
	}
	return next;
}

/**
 * Collapse a rendered card to 1–4 lines: the first visible line (type + cmd)
 * plus up to `viewport` content lines. Empty viewport → header only.
 * Success cards use a tail viewport (streaming output moves up).
 * Error cards use a head viewport so the failure lead is visible.
 * Duration (`Took` / `Elapsed`) is expanded-only.
 */
export function compactCardLines(
	lines: readonly string[],
	viewport = COMPACT_VIEWPORT_LINES,
	mode: "tail" | "head" = "tail",
): string[] {
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
	const rest = dropTrailingDuration(lines.slice(restStart, end));
	if (rest.length === 0) {
		return [header];
	}
	if (rest.length <= viewport) {
		return [header, ...rest];
	}
	return [header, ...(mode === "head" ? rest.slice(0, viewport) : rest.slice(-viewport))];
}

/** Last `viewport` non-empty lines of a thinking / output blob. Empty → []. */
export function compactViewportLines(text: string, viewport = COMPACT_VIEWPORT_LINES): string[] {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return [];
	}
	return lines.slice(-viewport);
}
