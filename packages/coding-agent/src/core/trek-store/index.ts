export { commitPromptFiles, currentBranch, type GitRef, isGitRepo, suggestTaskBranch } from "./git.ts";
export { nodeTrekStoreFs } from "./node-fs.ts";
export { type ParsedPathOp, parseBashPathOps } from "./path-ops.ts";
export { type RecordOptions, type TrekStoreFs, TrekVersionStore } from "./store.ts";
export type {
	FileVersionRecord,
	HistoryRow,
	PromptHistoryEntry,
	RestoreResult,
	TrekManifest,
	VersionArtifact,
	VersionKind,
} from "./types.ts";
export { TREK_STORE_VERSION } from "./types.ts";
