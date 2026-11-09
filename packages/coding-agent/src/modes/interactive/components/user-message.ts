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

function normalizeUserPrompt(text: string): string {
	return text
		.replace(/^\uFEFF/, "")
		.replace(/\r\n/g, "\n")
		.trim();
}

/** Long-task / layering resume text. Never paint as a grey user card. */
export function isQuietContinuePrompt(text: string): boolean {
	const body = normalizeUserPrompt(text);
	if (!body) {
		return false;
	}
	if (body.startsWith("Continue the layering task.") || body.startsWith("Continue the same task until it is done.")) {
		return true;
	}
	if (
		body.includes("Continue the same task until it is done.") &&
		(body.includes("Original request:") || body.includes("Do not emit new_topic."))
	) {
		return true;
	}
	return body.includes("Continue the layering task.") && body.includes("User turn:");
}

export function quietArchonLabel(text: string): string | undefined {
	const body = normalizeUserPrompt(text);
	if (isQuietContinuePrompt(text)) {
		return "· continue";
	}
	const archon =
		body.startsWith("Answer only this Archon node.") ||
		body.startsWith("Answer this step only.") ||
		body.includes("\nAnswer only this Archon node.") ||
		body.includes("\nAnswer this step only.");
	if (!archon) {
		return undefined;
	}
	const id = body.match(STEP_ID)?.[1];
	return id ? `· ${id}` : "· step";
}
