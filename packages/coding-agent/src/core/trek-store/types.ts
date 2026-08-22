import type { PreImage } from "../edit-checkpoints/checkpoint-manager.ts";

export const TREK_STORE_VERSION = 1 as const;

export type VersionKind = "edit" | "create" | "delete" | "rename";

export interface FileVersionRecord {
	path: string;
	from: number;
	to: number;
	kind: VersionKind;
	artifact: string;
	toPath?: string;
}

export interface PromptHistoryEntry {
	promptId: string;
	stepId?: string;
	files: FileVersionRecord[];
	git?: { branch?: string; commit?: string };
}

export interface TrekManifest {
	version: typeof TREK_STORE_VERSION;
	prompts: Record<string, PromptHistoryEntry>;
}

export interface VersionArtifact {
	kind: VersionKind;
	path: string;
	toPath?: string;
	promptNumber: number;
	promptId: string;
	stepId?: string;
	before: PreImage;
	diff?: string;
}

export interface HistoryRow {
	promptNumber: number;
	promptId: string;
	stepId?: string;
	path: string;
	kind: VersionKind;
	from: number;
	to: number;
	artifact: string;
	git?: { branch?: string; commit?: string };
}

export interface RestoreResult {
	restored: string[];
	removed: string[];
	renamed: string[];
}
