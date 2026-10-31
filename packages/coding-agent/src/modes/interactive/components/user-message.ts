import { Box, Container, Markdown, type MarkdownTheme, Spacer, Text } from "@trek/tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const NODE_HEADER = /^(?:User turn:|Known facts:|Node [A-Za-z0-9_-]+:|\$[A-Za-z0-9_-]+\.output:)$/;

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
	private contentBox: Box;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.contentBox = new Box(1, 1, (content: string) => theme.bg("userMessageBg", content));
		if (text.startsWith("Answer only this Archon node.")) {
			this.addNodeCard(text);
		} else {
			this.contentBox.addChild(
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
		}
		this.addChild(this.contentBox);
	}

	/** Rules, labels, and values on the same grey card, in three shades. */
	private addNodeCard(text: string): void {
		const rules: string[] = [];
		let section: { label: string; lines: string[] } | undefined;
		let started = false;
		const paintRules = () => {
			const body = rules.join("\n").trim();
			rules.length = 0;
			if (!body) return;
			if (started) this.contentBox.addChild(new Spacer(1));
			started = true;
			for (const line of body.split("\n")) {
				if (line.trim()) this.contentBox.addChild(new Text(theme.fg("dim", line), 0, 0));
			}
		};
		const flush = () => {
			if (!section) return;
			if (started) this.contentBox.addChild(new Spacer(1));
			started = true;
			this.contentBox.addChild(new Text(theme.fg("accent", section.label), 0, 0));
			for (const line of section.lines.join("\n").trim().split("\n")) {
				if (!line.trim()) continue;
				const painted = section.label === "Known facts:" ? paintFacts(line) : theme.fg("text", line);
				this.contentBox.addChild(new Text(painted, 0, 0));
			}
			section = undefined;
		};
		for (const line of text.split("\n")) {
			if (NODE_HEADER.test(line.trim())) {
				if (!section) paintRules();
				flush();
				section = { label: line.trim(), lines: [] };
				continue;
			}
			if (section) section.lines.push(line);
			else rules.push(line);
		}
		if (!section) paintRules();
		flush();
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}
}

function paintFacts(line: string): string {
	const cut = line.indexOf(": ");
	if (cut <= 0) return theme.fg("text", line);
	return `${theme.fg("muted", line.slice(0, cut + 1))} ${theme.fg("text", line.slice(cut + 2))}`;
}
