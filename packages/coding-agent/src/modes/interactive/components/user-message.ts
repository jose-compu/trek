import { Box, Container, Markdown, type MarkdownTheme, Text } from "@trek/tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const STEP_ID = /^(?:Node|Step) ([A-Za-z0-9_-]+):$/m;

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private readonly quiet: boolean;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		const quiet = quietArchonLabel(text);
		this.quiet = Boolean(quiet);
		if (quiet) {
			this.addChild(new Text(theme.fg("dim", quiet), 0, 0));
			return;
		}
		const contentBox = new Box(1, 1, (content: string) => theme.bg("userMessageBg", content));
		contentBox.addChild(
			new Markdown(
				text,
				0,
				0,
				markdownTheme,
				{
					color: (content: string) => theme.fg("userMessageText", content),
				},
				{ preserveOrderedListMarkers: true },
			),
		);
		this.addChild(contentBox);
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.quiet || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}
}

export function quietArchonLabel(text: string): string | undefined {
	if (text.startsWith("Continue the layering task.")) {
		return "· continue";
	}
	if (!text.startsWith("Answer only this Archon node.") && !text.startsWith("Answer this step only.")) {
		return undefined;
	}
	const id = text.match(STEP_ID)?.[1];
	return id ? `· ${id}` : "· step";
}
