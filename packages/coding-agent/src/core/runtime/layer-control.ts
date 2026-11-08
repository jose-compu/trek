/**
 * Closed user control grammar for ladder/runner pins.
 * Soft intent is Decision's job — do not grow this verb list ad hoc.
 */

export type ControlAsk =
	| { kind: "climb"; role: "planning" | "frontier"; why: string }
	| { kind: "drop"; role: "workhorse" | "planning" | "decision" | "next"; why: string }
	| { kind: "delegate"; why: string };

const VERB = "use|switch|swith|swich|swtich|switching|move|go|escalate|scalate|descalate|delegate|consult|hand\\s*off";
const ROLE = "planning|frontier|workhorse|tooling|decision";

const SLASH = /(?:^|\s)\/(planning|frontier|workhorse|tooling|decision|descalate|escalate|new-topic)\b/i;

const PHRASE = new RegExp(
	`(?:^|\\s)(?:${VERB})(?:\\s+(?:layering|the\\s+ladder|only))?(?:\\s+to)?(?:\\s+the)?\\s+(${ROLE})(?:\\s+(?:grok\\s+)?model)?\\b`,
	"i",
);

const BACK = /\bgo back to (workhorse|decision)\b/i;
const CONSULT_ONLY = /\bconsult(?:\s+only)\b/i;
const BARE_DESCALATE = /(?:^|\s)\/?descalate\b/i;
const SIMPLER = /\bsimpler model\b/i;

function mapSlash(token: string): ControlAsk | undefined {
	switch (token) {
		case "planning":
		case "frontier":
			return { kind: "climb", role: token, why: "user requested elevation" };
		case "workhorse":
			return { kind: "drop", role: "workhorse", why: "user requested descalation" };
		case "tooling":
			return { kind: "delegate", why: "delegate to tooling" };
		case "decision":
		case "new-topic":
			return { kind: "drop", role: "decision", why: "user requested descalation" };
		case "descalate":
			return { kind: "drop", role: "next", why: "user requested descalation" };
		default:
			return undefined;
	}
}

function mapVerbRole(matched: string, role: string): ControlAsk | undefined {
	const verb = matched.toLowerCase();
	const dropping = /\bdescalate\b/.test(verb);
	if (role === "tooling") {
		return { kind: "delegate", why: "delegate to tooling" };
	}
	if (role === "decision") {
		return { kind: "drop", role: "decision", why: "user requested descalation" };
	}
	if (role === "workhorse") {
		return { kind: "drop", role: "workhorse", why: "user requested descalation" };
	}
	if (role === "planning" || role === "frontier") {
		if (dropping) {
			return role === "planning" ? { kind: "drop", role: "planning", why: "user requested descalation" } : undefined;
		}
		return { kind: "climb", role, why: "user requested elevation" };
	}
	return undefined;
}

/** Named climb, drop, or Tooling delegate. Undefined for ordinary tasks. */
export function parseControlAsk(text: string): ControlAsk | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	const slash = trimmed.match(SLASH);
	if (slash) {
		const mapped = mapSlash(slash[1]!.toLowerCase());
		if (mapped) {
			return mapped;
		}
	}
	if (CONSULT_ONLY.test(trimmed) && !PHRASE.test(trimmed)) {
		return { kind: "climb", role: "frontier", why: "user requested elevation" };
	}
	const back = trimmed.match(BACK);
	if (back) {
		const role = back[1]!.toLowerCase() as "workhorse" | "decision";
		return { kind: "drop", role, why: "user requested descalation" };
	}
	const phrase = trimmed.match(PHRASE);
	if (phrase) {
		return mapVerbRole(phrase[0], phrase[1]!.toLowerCase());
	}
	if (BARE_DESCALATE.test(trimmed) && !/\btooling\b/i.test(trimmed)) {
		return { kind: "drop", role: "next", why: "user requested descalation" };
	}
	if (SIMPLER.test(trimmed)) {
		return { kind: "drop", role: "next", why: "user requested descalation" };
	}
	return undefined;
}

/** True when the prompt pins a role or runner (including `/escalate` with no target). */
export function isControlPrompt(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	if (parseControlAsk(trimmed)) {
		return true;
	}
	return /(?:^|\s)\/escalate\b/i.test(trimmed);
}
