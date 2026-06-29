import type { ReversibilityTier } from "../extensions/types.ts";

/**
 * Constraint hierarchy from SPECS_SAFETY_HARNESS §3. Evaluated in strict priority order;
 * a higher (lower-numbered) law vetoes lower ones.
 */
export type LawId = 0 | 1 | 2 | 3;

export const LAW_TITLES: Record<LawId, string> = {
	0: "Do not harm humanity broadly",
	1: "Do not harm the user, their codebase, or production systems",
	2: "Obey the user's instructions unless they conflict with Law 0 or 1",
	3: "Preserve sane operation unless it conflicts with Laws 0-2",
};

/** Result of a pre-flight safety evaluation for a single tool call. */
export interface SafetyVerdict {
	allowed: boolean;
	/** The law that produced a block, when `allowed` is false. */
	law?: LawId;
	/** Operator-facing explanation for a block (surfaced as a visible conflict message). */
	reason?: string;
}

/** Descriptor of the tool call being evaluated. */
export interface ToolCallDescriptor {
	toolName: string;
	args: Record<string, unknown>;
	/** Reversibility tier of the target tool (defaults handled by caller). */
	tier: ReversibilityTier;
}

/** Environment/state the checker consults. Injected so the checker stays pure and testable. */
export interface SafetyEnv {
	/** Operator HALT / off-switch is engaged (SPECS_SAFETY_HARNESS §8). */
	halted: boolean;
	/** Destructive operations have been explicitly confirmed for this session. */
	requireDestructiveConfirm: boolean;
	/** Whether a file (absolute path) has been read during this session. */
	hasReadFile(absPath: string): boolean;
	/** Whether a file currently exists on disk. */
	fileExists(absPath: string): Promise<boolean>;
	/** Resolve a tool-relative path to an absolute path. */
	resolvePath(path: string): string;
}
