/**
 * Archon `when:` and `trigger_rule` (subset of https://archon.diy/reference/workflow-language/).
 */

export type ArchonTriggerRule =
	| "all_success"
	| "any_success"
	| "all_done"
	| "none_failed_min_one_success"
	| "one_success";

export type NodeRunStatus = "ok" | "skipped" | "failed";

export const ARCHON_TRIGGER_RULES = [
	"all_success",
	"any_success",
	"all_done",
	"none_failed_min_one_success",
	"one_success",
] as const;

export function isArchonTriggerRule(value: string): value is ArchonTriggerRule {
	return (ARCHON_TRIGGER_RULES as readonly string[]).includes(value);
}

export function normalizeTriggerRule(rule: ArchonTriggerRule | undefined): ArchonTriggerRule {
	if (rule === "one_success") {
		return "any_success";
	}
	return rule ?? "all_success";
}

export function shouldRunByTrigger(
	rule: ArchonTriggerRule | undefined,
	deps: readonly string[],
	statuses: ReadonlyMap<string, NodeRunStatus>,
): boolean {
	if (deps.length === 0) {
		return true;
	}
	const states = deps.map((id) => statuses.get(id) ?? "failed");
	const resolved = normalizeTriggerRule(rule);
	if (resolved === "all_done") {
		return true;
	}
	if (resolved === "any_success") {
		return states.some((state) => state === "ok");
	}
	if (resolved === "none_failed_min_one_success") {
		return states.some((state) => state === "ok") && !states.some((state) => state === "failed");
	}
	return states.every((state) => state === "ok");
}

export function evaluateWhen(
	when: string | undefined,
	ctx: { userMessage: string; outputs: ReadonlyMap<string, string> },
): boolean {
	if (!when || when.trim().length === 0) {
		return true;
	}
	return evalOr(when.trim(), ctx);
}

function evalOr(expr: string, ctx: { userMessage: string; outputs: ReadonlyMap<string, string> }): boolean {
	const parts = splitTop(expr, "||");
	if (parts.length === 1) {
		return evalAnd(parts[0]!, ctx);
	}
	return parts.some((part) => evalAnd(part, ctx));
}

function evalAnd(expr: string, ctx: { userMessage: string; outputs: ReadonlyMap<string, string> }): boolean {
	const parts = splitTop(expr, "&&");
	if (parts.length === 1) {
		return evalAtom(parts[0]!, ctx);
	}
	return parts.every((part) => evalAtom(part, ctx));
}

function evalAtom(expr: string, ctx: { userMessage: string; outputs: ReadonlyMap<string, string> }): boolean {
	const trimmed = expr.trim();
	const contains = trimmed.match(
		/^(\$USER_MESSAGE|\$([A-Za-z0-9_-]+)\.output(?:\.([A-Za-z0-9_]+))?)\s+contains\s+'((?:\\'|[^'])*)'$/i,
	);
	if (contains) {
		const left = resolveRef(contains[1]!, contains[2], contains[3], ctx);
		return left.toLowerCase().includes(unescapeQuoted(contains[4]!).toLowerCase());
	}
	const cmp = trimmed.match(
		/^(\$USER_MESSAGE|\$([A-Za-z0-9_-]+)\.output(?:\.([A-Za-z0-9_]+))?)\s*(==|!=)\s+'((?:\\'|[^'])*)'$/,
	);
	if (cmp) {
		const left = resolveRef(cmp[1]!, cmp[2], cmp[3], ctx);
		const right = unescapeQuoted(cmp[5]!);
		return cmp[4] === "==" ? left === right : left !== right;
	}
	throw new Error(`unsupported when: ${trimmed}`);
}

function resolveRef(
	whole: string,
	nodeId: string | undefined,
	field: string | undefined,
	ctx: { userMessage: string; outputs: ReadonlyMap<string, string> },
): string {
	if (whole === "$USER_MESSAGE") {
		return ctx.userMessage;
	}
	if (!nodeId) {
		return "";
	}
	const raw = ctx.outputs.get(nodeId) ?? "";
	if (!field) {
		return raw;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && field in parsed) {
			const value = (parsed as Record<string, unknown>)[field];
			return typeof value === "string" ? value : JSON.stringify(value);
		}
	} catch {
		return "";
	}
	return "";
}

function unescapeQuoted(value: string): string {
	return value.replace(/\\'/g, "'");
}

function splitTop(expr: string, sep: "&&" | "||"): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < expr.length; index++) {
		const ch = expr[index];
		if (ch === "'") {
			index += 1;
			while (index < expr.length && expr[index] !== "'") {
				if (expr[index] === "\\") {
					index += 1;
				}
				index += 1;
			}
			continue;
		}
		if (ch === "(") {
			depth += 1;
		}
		if (ch === ")") {
			depth -= 1;
		}
		if (depth === 0 && expr.slice(index, index + sep.length) === sep) {
			parts.push(expr.slice(start, index));
			index += sep.length - 1;
			start = index + 1;
		}
	}
	parts.push(expr.slice(start));
	return parts.map((part) => part.trim()).filter(Boolean);
}
