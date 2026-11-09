/**
 * Bash refusals and redirects for the 0.19 Unix kit.
 * Interactive editors, dd, and find -delete are refused.
 * sed -i / ex on a path redirect to script_edit. xargs -P is capped at 4.
 */

export const MAX_XARGS_PARALLEL = 4;

export type UnixGuardResult =
	| { action: "ok"; command: string }
	| { action: "refuse"; reason: string }
	| { action: "redirect"; hint: string }
	| { action: "rewrite"; command: string };

const INTERACTIVE = /^(?:sudo\s+)?(vim|vi|view|nvim|nano|emacs|less|more|most)(?:\s|$)/;
const BATCH_VIM = /\s-Es\b|\s-e\b.*\s-s\b|\s-s\b.*\s-e\b/;
const FIND_DELETE = /\bfind\b[\s\S]*\s-delete\b/;
const DD = /(?:^|[;&|]\s*)dd(?:\s|$)/;
const SED_INPLACE = /(?:^|[;&|]\s*)sed\b[^;&|\n]*\s-i\b/;
const EX_EDIT = /(?:^|[;&|]\s*)ex\b/;
const XARGS_P = /\bxargs\b([^;&|\n]*?)-P\s*(\d+)/g;

function firstCommand(command: string): string {
	return command.trim().split(/\s*[;&|]\s*/)[0] ?? command;
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
	const head = firstCommand(trimmed);
	const interactive = INTERACTIVE.exec(head);
	if (interactive) {
		const name = interactive[1] ?? "";
		if ((name === "vim" || name === "vi" || name === "nvim" || name === "view") && BATCH_VIM.test(head)) {
			return {
				action: "redirect",
				hint: "Use script_edit with engine=vim (vim -Es). Do not open a TUI.",
			};
		}
		return {
			action: "refuse",
			reason: `Interactive ${name} is not allowed. Use script_edit (ex / vim -Es / ed / sed).`,
		};
	}
	if (SED_INPLACE.test(trimmed) || EX_EDIT.test(trimmed)) {
		return {
			action: "redirect",
			hint: "Use script_edit {path, engine, script} so the file is snapshotted and Law 1 applies.",
		};
	}
	let rewritten = trimmed;
	let capped = false;
	rewritten = rewritten.replace(XARGS_P, (_all, rest: string, n: string) => {
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
