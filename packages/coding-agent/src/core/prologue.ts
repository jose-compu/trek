/**
 * Prologue / constitution loading for Trek sessions.
 *
 * Global: ~/.trek/prologue.md
 * Project override: .trek/prologue.md (replaces global when present)
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { getGlobalProloguePath, getProjectProloguePath } from "../config.ts";

export interface LoadedPrologue {
	content: string | undefined;
	sources: string[];
}

/** Load prologue for a project cwd. Project file overrides global when it exists. */
export function loadPrologue(cwd: string): LoadedPrologue {
	const projectPath = getProjectProloguePath(cwd);
	if (existsSync(projectPath)) {
		return {
			content: readFileSync(projectPath, "utf8").trim() || undefined,
			sources: [projectPath],
		};
	}

	const globalPath = getGlobalProloguePath();
	if (existsSync(globalPath)) {
		return {
			content: readFileSync(globalPath, "utf8").trim() || undefined,
			sources: [globalPath],
		};
	}

	return { content: undefined, sources: [] };
}

/** Short SHA-256 prefix for trace metadata. */
export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Format prologue for injection into the system prompt. */
export function formatPrologueSection(content: string): string {
	return `<prologue>\n${content}\n</prologue>`;
}
