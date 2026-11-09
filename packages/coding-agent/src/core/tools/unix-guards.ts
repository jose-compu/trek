/**
 * Bash refusals and redirects for the 0.19 Unix kit.
 * Interactive editors, dd, and find -delete are refused.
 * A lone sed -i / vim -Es becomes script_edit (no error). Mixed scripts keep bash.
 * xargs -P is capped at 4.
 */

export const MAX_XARGS_PARALLEL = 4;

export type InplaceEdit = { engine: "sed" | "vim"; path: string; script: string };

export type UnixGuardResult =
	| { action: "ok"; command: string }
	| { action: "refuse"; reason: string }
	| { action: "script_edit"; edit: InplaceEdit }
	| { action: "rewrite"; command: string };

const INTERACTIVE = /^(?:sudo\s+)?(vim|vi|view|nvim|nano|emacs|less|more|most)(?:\s|$)/;
const BATCH_VIM = /\s-Es\b|\s-e\b.*\s-s\b|\s-s\b.*\s-e\b/;
const FIND_DELETE = /\bfind\b[\s\S]*\s-delete\b/;
const DD = /(?:^|[;&|]\s*)dd(?:\s|$)/;
const SED_INPLACE = /(?:^|[;&|\n]\s*)sed\b[^;&|\n]*\s-i\b/;
const COMPOUND = /(?:&&|\|\||[;&|]|\n)/;

function commandParts(command: string): string[] {
	return command
		.split(/\s*(?:&&|\|\||[;&|])\s*/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

/** Quote-aware tokens. Empty quotes become "". */
export function tokenizeCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let sawQuote = false;
	for (const ch of command.trim()) {
		if (quote) {
			if (ch === quote) {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			sawQuote = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current || sawQuote) {
				tokens.push(current);
				current = "";
				sawQuote = false;
			}
			continue;
		}
		current += ch;
		sawQuote = false;
	}
	if (current || sawQuote) {
		tokens.push(current);
	}
	return tokens;
}

function looksLikeSedProgram(token: string): boolean {
	return /^(?:s|y|S|[0-9]*[aAicCdDgGhHlnNpPwW{/#\\])/.test(token);
}

function looksLikeBackupSuffix(token: string): boolean {
	return token === "" || /^\.[A-Za-z0-9._-]+$/.test(token);
}

/** Parse a single `sed -i` invocation. */
export function parseSedInplace(command: string): InplaceEdit | undefined {
	const tokens = tokenizeCommand(command);
	if (tokens[0] !== "sed") {
		return undefined;
	}
	let inplace = false;
	const scripts: string[] = [];
	const rest: string[] = [];
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "-i" || (token.startsWith("-i") && token !== "-i")) {
			inplace = true;
			if (token.length > 2) {
				continue;
			}
			const next = tokens[i + 1];
			if (next !== undefined && looksLikeBackupSuffix(next) && !looksLikeSedProgram(next)) {
				i += 1;
			}
			continue;
		}
		if (token === "-e" || token === "-f") {
			const next = tokens[i + 1];
			if (next === undefined) {
				return undefined;
			}
			scripts.push(next);
			i += 1;
			continue;
		}
		if (token.startsWith("-")) {
			continue;
		}
		rest.push(token);
	}
	if (!inplace || rest.length === 0) {
		return undefined;
	}
	let path = rest[rest.length - 1];
	const program = scripts.length > 0 ? scripts.join("\n") : rest.length >= 2 ? rest[0] : undefined;
	if (!program || !path) {
		return undefined;
	}
	if (scripts.length === 0 && rest.length >= 2) {
		path = rest[rest.length - 1];
	}
	return { engine: "sed", path, script: program };
}

function parseVimEs(command: string): InplaceEdit | undefined {
	const tokens = tokenizeCommand(command);
	const bin = tokens[0];
	if (bin !== "vim" && bin !== "vi" && bin !== "nvim") {
		return undefined;
	}
	if (!BATCH_VIM.test(` ${command}`)) {
		return undefined;
	}
	const scripts: string[] = [];
	const rest: string[] = [];
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "-c" || token === "-s") {
			const next = tokens[i + 1];
			if (next && token === "-c") {
				scripts.push(next);
				i += 1;
			}
			continue;
		}
		if (token.startsWith("-")) {
			continue;
		}
		rest.push(token);
	}
	const path = rest[rest.length - 1];
	if (!path || scripts.length === 0) {
		return undefined;
	}
	return { engine: "vim", path, script: `${scripts.join("\n")}\n` };
}

export function extractInplacePaths(command: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const chunks = command.split(/\n/).flatMap((line) => commandParts(line));
	for (const chunk of chunks) {
		const sedAt = chunk.search(/\bsed\s+-i\b/);
		const fromSed = sedAt >= 0 ? chunk.slice(sedAt) : chunk;
		const edit = parseSedInplace(fromSed) ?? parseVimEs(chunk);
		if (edit && !seen.has(edit.path)) {
			seen.add(edit.path);
			paths.push(edit.path);
		}
	}
	return paths;
}

function isSingleInvocation(command: string): boolean {
	const trimmed = command.trim();
	return !COMPOUND.test(trimmed) && !trimmed.includes("\n");
}

export function inspectBashCommand(command: string): UnixGuardResult {
	const trimmed = command.trim();
	if (!trimmed) {
		return { action: "ok", command };
	}
	if (DD.test(trimmed) || /^\s*dd\b/.test(trimmed)) {
		return { action: "refuse", reason: "dd is not allowed. Use script_edit or a bounded recipe." };
	}
	if (FIND_DELETE.test(trimmed)) {
		return { action: "refuse", reason: "find -delete is not allowed." };
	}
	for (const head of commandParts(trimmed)) {
		const interactive = INTERACTIVE.exec(head);
		if (!interactive) {
			continue;
		}
		const name = interactive[1] ?? "";
		if ((name === "vim" || name === "vi" || name === "nvim" || name === "view") && BATCH_VIM.test(head)) {
			const edit = parseVimEs(head);
			if (edit && isSingleInvocation(trimmed)) {
				return { action: "script_edit", edit };
			}
			return { action: "ok", command };
		}
		return {
			action: "refuse",
			reason: `Interactive ${name} is not allowed. Use script_edit (ex / vim -Es / ed / sed).`,
		};
	}
	if (SED_INPLACE.test(trimmed) || /^\s*sed\b/.test(trimmed)) {
		const edit = parseSedInplace(isSingleInvocation(trimmed) ? trimmed : (trimmed.split(/\n/)[0] ?? trimmed));
		if (edit && isSingleInvocation(trimmed)) {
			return { action: "script_edit", edit };
		}
		return { action: "ok", command };
	}
	let rewritten = trimmed;
	let capped = false;
	rewritten = rewritten.replace(/\bxargs\b([^;&|\n]*?)-P\s*(\d+)/g, (_all, rest: string, n: string) => {
		const count = Number(n);
		if (count > MAX_XARGS_PARALLEL) {
			capped = true;
			return `xargs${rest}-P ${MAX_XARGS_PARALLEL}`;
		}
		return `xargs${rest}-P ${n}`;
	});
	if (capped) {
		return { action: "rewrite", command: rewritten };
	}
	return { action: "ok", command };
}
