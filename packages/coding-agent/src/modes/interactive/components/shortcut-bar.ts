import { type Component, truncateToWidth } from "@trek/tui";
import type { AppKeybinding } from "../../../core/keybindings.ts";
import { theme } from "../theme/theme.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

/** Visibility of the shortcut bar below the editor input. */
export type ShortcutBarVisibility = "hidden" | "compact" | "expanded";

export function cycleShortcutBarVisibility(current: ShortcutBarVisibility): ShortcutBarVisibility {
	if (current === "hidden") return "compact";
	if (current === "compact") return "expanded";
	return "hidden";
}

type ShortcutEntry = AppKeybinding | { raw: string; description: string };

const COMPACT_SHORTCUTS: ShortcutEntry[] = [
	"app.interrupt",
	"app.edits.undo",
	"app.edits.keepAll",
	"app.edits.dryRun",
	{ raw: "/", description: "commands" },
	{ raw: "!", description: "bash" },
	"app.shortcuts.toggle",
];

const EXPANDED_SECTIONS: { title: string; entries: ShortcutEntry[] }[] = [
	{
		title: "Safety & edits (0.4.0)",
		entries: ["app.interrupt", "app.edits.undo", "app.edits.keepAll", "app.edits.dryRun"],
	},
	{
		title: "Session",
		entries: [
			"app.clear",
			"app.exit",
			"app.suspend",
			"app.session.fork",
			"app.session.new",
			"app.message.followUp",
			"app.message.dequeue",
		],
	},
	{
		title: "Model & tools",
		entries: [
			"app.model.cycleForward",
			"app.model.cycleBackward",
			"app.model.select",
			"app.thinking.cycle",
			"app.thinking.toggle",
			"app.tools.expand",
			"app.editor.external",
		],
	},
	{
		title: "Input",
		entries: [
			{ raw: "/", description: "slash commands" },
			{ raw: "!", description: "bash mode" },
			{ raw: "!!", description: "bash (no context)" },
			"app.clipboard.pasteImage",
		],
	},
];

function formatEntry(entry: ShortcutEntry): string {
	if (typeof entry === "string") {
		const descriptions: Partial<Record<AppKeybinding, string>> = {
			"app.interrupt": "stop",
			"app.edits.undo": "undo",
			"app.edits.keepAll": "keep all",
			"app.edits.dryRun": "dry-run",
			"app.shortcuts.toggle": "toggle",
			"app.clear": "clear",
			"app.exit": "exit",
			"app.suspend": "suspend",
			"app.session.fork": "fork",
			"app.session.new": "new session",
			"app.message.followUp": "follow-up",
			"app.message.dequeue": "edit queue",
			"app.model.cycleForward": "next model",
			"app.model.cycleBackward": "prev model",
			"app.model.select": "select model",
			"app.thinking.cycle": "thinking",
			"app.thinking.toggle": "thinking blocks",
			"app.tools.expand": "expand tools",
			"app.editor.external": "ext. editor",
			"app.clipboard.pasteImage": "paste image",
		};
		return keyHint(entry, descriptions[entry] ?? entry);
	}
	return rawKeyHint(entry.raw, entry.description);
}

function joinCompact(entries: ShortcutEntry[], separator: string): string {
	return entries.map(formatEntry).join(separator);
}

/**
 * Shortcut cheat bar rendered directly below the editor input.
 * Cycles hidden → compact → expanded via app.shortcuts.toggle.
 */
export class ShortcutBarComponent implements Component {
	private getVisibility: () => ShortcutBarVisibility;

	constructor(getVisibility: () => ShortcutBarVisibility) {
		this.getVisibility = getVisibility;
	}

	invalidate(): void {
		// Stateless render; nothing to clear.
	}

	render(width: number): string[] {
		const visibility = this.getVisibility();
		const separator = theme.fg("muted", " · ");

		if (visibility === "hidden") {
			const line = keyHint("app.shortcuts.toggle", "show shortcuts");
			return [truncateToWidth(theme.fg("dim", line), width, theme.fg("dim", "..."))];
		}

		if (visibility === "compact") {
			const line = joinCompact(COMPACT_SHORTCUTS, separator);
			return [truncateToWidth(theme.fg("dim", line), width, theme.fg("dim", "..."))];
		}

		const lines: string[] = [];
		lines.push(
			truncateToWidth(
				theme.fg("dim", `Shortcuts`) + separator + keyHint("app.shortcuts.toggle", "hide"),
				width,
				theme.fg("dim", "..."),
			),
		);
		for (const section of EXPANDED_SECTIONS) {
			lines.push(truncateToWidth(theme.fg("muted", section.title), width));
			const sectionLine = joinCompact(section.entries, separator);
			lines.push(truncateToWidth(theme.fg("dim", sectionLine), width, theme.fg("dim", "...")));
		}
		return lines;
	}
}
