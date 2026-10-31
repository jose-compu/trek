import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{
		name: "hierarchy",
		description:
			"Set api, local, or hybrid, the suite, and one role. Writes ~/.trek/models.yaml. The next session reads it.",
	},
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Configure provider authentication" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "undo", description: "Undo agent edits back to a specific prompt (opens selector)" },
	{ name: "processes", description: "Show this prompt's parallel, sequence, guarded choice, and inversion tree" },
	{ name: "memory", description: "Show memory, /memory index, /memory add <path>, or /memory remove <path>" },
	{
		name: "domains",
		description:
			"List domains, /domains enable <id>, or /domains disable <id>. Detection still chooses the workflow.",
	},
	{ name: "workflows", description: "List workflows, or /workflows show <id>. Does not run a workflow." },
	{ name: "lessons", description: "List stored lessons: /lessons or /lessons <domain>." },
	{
		name: "patterns",
		description:
			"List or edit domain patterns: /patterns, /patterns <id>, /patterns edit <id> categories|targets|never.",
	},
	{
		name: "crystallize",
		description:
			"Turn a lesson into a skill after you confirm: /crystallize <id>. /crystallize remove <id> takes it back.",
	},
	{ name: "confirm", description: "Allow the next call of one gated tool: /confirm bash" },
	{ name: "sandbox", description: "Toggle OS-level sandbox for agent bash commands" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "quit", description: `Quit ${APP_NAME}` },
];
