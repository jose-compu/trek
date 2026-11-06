import { type Component, truncateToWidth } from "@trek/tui";
import { theme } from "../theme/theme.ts";

/** "TREK AGENT" rendered in compact unicode block glyphs. */
export const BANNER_LINES: string[] = ["▄▖▄▖▄▖▖▖  ▄▖▄▖▄▖▖ ▖▄▖", "▐ ▙▘▙▖▙▘  ▌▌▌ ▙▖▛▖▌▐ ", "▐ ▌▌▙▖▌▌  ▛▌▙▌▙▖▌▝▌▐ "];

/**
 * Trek Agent ASCII banner. Persistent only while expanded (`ctrl+o`).
 * Compact mode keeps it off so the prompt sits on the last lines.
 */
export class AsciiBannerComponent implements Component {
	private expanded: boolean;

	constructor(expanded = false) {
		this.expanded = expanded;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	invalidate(): void {
		// Stateless render; nothing to clear.
	}

	render(width: number): string[] {
		if (!this.expanded) {
			return [];
		}
		return BANNER_LINES.map((line) => truncateToWidth(theme.fg("accent", line), width));
	}
}
