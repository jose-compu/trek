import type { SafetyEnv, SafetyVerdict, ToolCallDescriptor } from "./types.ts";

/** Law 0 — broadly harmful intent (malware, exfiltration, weaponized exploits, mass surveillance). */
const HARMFUL_PATTERN =
	/\b(malware|ransomware|keylogger|spyware|rootkit|botnet|exfiltrat\w*|steal\s+(?:credentials|passwords|secrets)|weaponiz\w*\s+exploit|mass\s+surveillance)\b/i;

/** Law 1 — irreversible/destructive shell operations that need explicit confirmation. */
const DESTRUCTIVE_BASH =
	/\brm\s+-rf\b|\brm\s+-fr\b|\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b|drop\s+database\b|\bmkfs\b|\b:\(\)\s*\{|\bgit\s+push\b[^\n]*--force\b|\bgit\s+push\b[^\n]*\s-f\b/i;

function getString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

/** Extract the bash command text from tool args, if present. */
export function getCommand(descriptor: ToolCallDescriptor): string | undefined {
	if (descriptor.toolName !== "bash") {
		return undefined;
	}
	return getString(descriptor.args, "command");
}

/** Extract the file path from write/edit tool args, if present. */
export function getFilePath(descriptor: ToolCallDescriptor): string | undefined {
	if (descriptor.toolName !== "write" && descriptor.toolName !== "edit") {
		return undefined;
	}
	return getString(descriptor.args, "path") ?? getString(descriptor.args, "file_path");
}

/** Law 0: refuse broadly harmful actions. Returns a reason when blocked. */
export function checkLaw0(descriptor: ToolCallDescriptor): string | undefined {
	const haystacks = [getCommand(descriptor), getString(descriptor.args, "content")].filter(
		(s): s is string => typeof s === "string",
	);
	for (const text of haystacks) {
		if (HARMFUL_PATTERN.test(text)) {
			return "Action appears to facilitate broadly harmful work (Law 0) and was blocked.";
		}
	}
	return undefined;
}

/**
 * Law 1: protect the user, their codebase, and production systems.
 * - Destructive shell commands require explicit confirmation.
 * - Forbidden-tier tools are never auto-run.
 * - Read-before-write: do not overwrite/edit an existing file the agent has not read this session.
 */
export async function checkLaw1(descriptor: ToolCallDescriptor, env: SafetyEnv): Promise<string | undefined> {
	const command = getCommand(descriptor);
	if (command && DESTRUCTIVE_BASH.test(command) && !env.requireDestructiveConfirm) {
		return "Destructive shell command blocked without explicit confirmation (Law 1): e.g. rm -rf, force-push, drop database.";
	}

	if (descriptor.tier === "forbidden") {
		return `Tool "${descriptor.toolName}" is forbidden by default (Law 1) and requires operator co-sign.`;
	}

	const filePath = getFilePath(descriptor);
	if (filePath) {
		const absPath = env.resolvePath(filePath);
		const exists = await env.fileExists(absPath);
		// Editing always targets an existing file; writing only clobbers when the file already exists.
		// In both cases, refuse to mutate a file the agent has not read this session.
		if (exists && !env.hasReadFile(absPath)) {
			return `Refusing to modify "${filePath}" before reading it this session (Law 1: read-before-write). Read the file first.`;
		}
	}

	return undefined;
}

/** Evaluate the full law hierarchy in strict order. */
export async function evaluateLaws(descriptor: ToolCallDescriptor, env: SafetyEnv): Promise<SafetyVerdict> {
	const law0 = checkLaw0(descriptor);
	if (law0) {
		return { allowed: false, law: 0, reason: law0 };
	}
	const law1 = await checkLaw1(descriptor, env);
	if (law1) {
		return { allowed: false, law: 1, reason: law1 };
	}
	return { allowed: true };
}
