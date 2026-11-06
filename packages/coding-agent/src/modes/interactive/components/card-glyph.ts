import type { Theme } from "../theme/theme.ts";

/** Single-cell Unicode marks so compact cards scan without emoji width issues. */
export const CARD_GLYPH = {
	bash: "❯",
	read: "◉",
	write: "▣",
	edit: "△",
	ls: "▦",
	grep: "⌕",
	find: "⌖",
	workflow: "◆",
	thinking: "✦",
	skill: "◇",
	remember: "☆",
	recall: "☰",
	forget: "✕",
} as const;

export type CardKind = keyof typeof CARD_GLYPH;

export function cardGlyph(kind: string): string {
	return (CARD_GLYPH as Record<string, string>)[kind] ?? "▸";
}

export function toolCardTitle(theme: Theme, kind: string, label?: string): string {
	return theme.fg("toolTitle", theme.bold(`${cardGlyph(kind)} ${label ?? kind}`));
}
