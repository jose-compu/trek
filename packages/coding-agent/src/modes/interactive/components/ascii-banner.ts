import { type Component, truncateToWidth } from "@trek/tui";
import { theme } from "../theme/theme.ts";

/** "TREK AGENT" rendered in compact unicode block glyphs. */
const BANNER_LINES: string[] = ["▄▖▄▖▄▖▖▖  ▄▖▄▖▄▖▖ ▖▄▖", "▐ ▙▘▙▖▙▘  ▌▌▌ ▙▖▛▖▌▐ ", "▐ ▌▌▙▖▌▌  ▛▌▙▌▙▖▌▝▌▐ "];

/**
 * Static Trek Agent ASCII banner. Mounted persistently above the editor input so it is
 * shown at startup and stays visible above the prompt line.
 */
export class AsciiBannerComponent implements Component {
	invalidate(): void {
		// Stateless render; nothing to clear.
	}

	render(width: number): string[] {
		return BANNER_LINES.map((line) => truncateToWidth(theme.fg("accent", line), width));
	}
}
