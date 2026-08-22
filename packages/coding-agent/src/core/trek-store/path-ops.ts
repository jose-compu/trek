/**
 * Parse simple, non-composed bash path mutations we can snapshot.
 * Rejects pipes, lists, and substitutions — those are not inverted.
 */

export type ParsedPathOp = { kind: "delete"; path: string } | { kind: "rename"; from: string; to: string };

const UNSAFE = /[|;&`$()<>]|&&|\|\|/;

function tokenize(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
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
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

/** Extract delete/rename ops from a simple `rm` / `mv` command, or null if not invertible. */
export function parseBashPathOps(command: string): ParsedPathOp[] | null {
	const trimmed = command.trim();
	if (!trimmed || UNSAFE.test(trimmed)) {
		return null;
	}
	const tokens = tokenize(trimmed);
	if (tokens.length === 0) {
		return null;
	}
	const cmd = tokens[0];
	const rest = tokens.slice(1).filter((t) => !t.startsWith("-"));
	if (cmd === "rm" || cmd === "unlink") {
		if (rest.length === 0) {
			return null;
		}
		return rest.map((path) => ({ kind: "delete" as const, path }));
	}
	if (cmd === "mv") {
		if (rest.length !== 2) {
			return null;
		}
		return [{ kind: "rename", from: rest[0], to: rest[1] }];
	}
	return null;
}
