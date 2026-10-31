import type { AssistantMessage } from "@trek/ai";
import { isContextOverflow } from "@trek/ai";
import { Container, Markdown, type MarkdownTheme, Spacer, Text } from "@trek/tui";
import { honestyDisplay, stripHonestyFooter } from "../../../core/honesty/index.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Drop text blocks that are strict prefixes of another text block (streaming/provider artifact). */
export function shouldRenderAssistantTextBlock(text: string, allTextBlocks: readonly string[]): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	return !allTextBlocks.some(
		(other) => other !== trimmed && other.startsWith(trimmed) && other.length > trimmed.length,
	);
}

function honestyCardLines(status: {
	confidence: "high" | "medium" | "low";
	assumptions: number;
	unverified: number;
	details: string[];
}): string[] {
	const tone = status.confidence === "high" ? "success" : status.confidence === "low" ? "error" : "warning";
	const mark = status.confidence === "high" ? "✔" : status.confidence === "low" ? "✖" : "⚠";
	const gap = theme.fg("dim", "   ");
	const count = (n: number, hot: "warning" | "error") => theme.fg(n > 0 ? hot : "muted", String(n));
	const head = [
		theme.bold(theme.fg(tone, `${mark} honesty`)),
		`${theme.fg("muted", "confidence")} ${theme.fg(tone, status.confidence)}`,
		`${theme.fg("muted", "assumptions")} ${count(status.assumptions, "warning")}`,
		`${theme.fg("muted", "unverified")} ${count(status.unverified, "error")}`,
	].join(gap);
	const lines = [head];
	for (const detail of status.details) {
		const split = detail.indexOf(": ");
		const key = split === -1 ? detail : detail.slice(0, split);
		const value = split === -1 ? "" : detail.slice(split + 2);
		const keyTone = key === "unverified" ? "error" : "warning";
		lines.push(`${theme.fg("dim", "            ")}${theme.fg(keyTone, key.padEnd(12))}${theme.fg("text", value)}`);
	}
	return lines;
}

function collectTrimmedTextBlocks(content: AssistantMessage["content"]): string[] {
	return content
		.filter((block) => block.type === "text" && block.text.trim())
		.map((block) => (block.type === "text" ? stripHonestyFooter(block.text).trim() : ""));
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		const trimmedTextBlocks = collectTrimmedTextBlocks(message.content);

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				const visible = stripHonestyFooter(content.text).trim();
				if (!visible || !shouldRenderAssistantTextBlock(visible, trimmedTextBlocks)) {
					continue;
				}
				this.contentContainer.addChild(new Markdown(visible, 1, 0, this.markdownTheme));
				const status = honestyDisplay(content.text);
				if (status) {
					for (const line of honestyCardLines(status)) {
						this.contentContainer.addChild(new Text(line, 1, 0));
					}
				}
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				if (this.hideThinkingBlock) {
					// Show static thinking label when hidden
					this.contentContainer.addChild(
						new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), 1, 0),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Thinking traces in thinkingText color, italic
					this.contentContainer.addChild(
						new Markdown(content.thinking.trim(), 1, 0, this.markdownTheme, {
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						}),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if aborted - show after partial content
		// But only if there are no tool calls (tool execution components will show the error)
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				if (hasVisibleContent) {
					this.contentContainer.addChild(new Spacer(1));
				} else {
					this.contentContainer.addChild(new Spacer(1));
				}
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), 1, 0));
			} else if (message.stopReason === "error") {
				// Context-size failures stay quiet (ladder may climb on first prompt).
				if (isContextOverflow(message)) {
					return;
				}
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), 1, 0));
			}
		}
	}
}
