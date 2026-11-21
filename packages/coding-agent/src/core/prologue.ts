/**
 * Prologue / constitution loading for Trek sessions.
 *
 * Global: ~/.trek/prologue.md
 * Project override: .trek/prologue.md (replaces global when present)
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { getGlobalProloguePath, getProjectProloguePath } from "../config.ts";
import { getSealedPrologueSource, loadSealedConstitution } from "./prologue/constitution.ts";

export interface LoadedPrologue {
	content: string | undefined;
	sources: string[];
}

function isSealedPrologueEnabled(): boolean {
	const flag = process.env.TREK_PROLOGUE;
	return flag !== "0" && flag !== "false";
}

/** Load prologue for a project cwd. Project file overrides global when it exists. */
export function loadPrologue(cwd: string): LoadedPrologue {
	const sources: string[] = [];
	const parts: string[] = [];

	if (isSealedPrologueEnabled()) {
		parts.push(loadSealedConstitution());
		sources.push(getSealedPrologueSource());
	}

	const projectPath = getProjectProloguePath(cwd);
	if (existsSync(projectPath)) {
		const fileContent = readFileSync(projectPath, "utf8").trim();
		if (fileContent) {
			parts.push(fileContent);
			sources.push(projectPath);
		}
		return { content: parts.join("\n\n"), sources };
	}

	const globalPath = getGlobalProloguePath();
	if (existsSync(globalPath)) {
		const fileContent = readFileSync(globalPath, "utf8").trim();
		if (fileContent) {
			parts.push(fileContent);
			sources.push(globalPath);
		}
		return { content: parts.length > 0 ? parts.join("\n\n") : undefined, sources };
	}

	return {
		content: parts.length > 0 ? parts.join("\n\n") : undefined,
		sources,
	};
}

/** Short SHA-256 prefix for trace metadata. */
export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Format prologue for injection into the system prompt. */
export function formatPrologueSection(content: string): string {
	return `<prologue>\n${content}\n</prologue>`;
}
