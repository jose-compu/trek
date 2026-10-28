/**
 * Guest text is screened before the model. A rule hit refuses the turn.
 * The guest reply does not name the class. The owner notice redacts credential-shaped spans.
 */

export type DangerClass =
	| "instruction_override"
	| "impersonation"
	| "secret_request"
	| "tool_request"
	| "exfiltration"
	| "safe_mode_off";

export type ChannelActor = "owner" | "guest";

export interface GuestScreen {
	verdict: "allow" | "refuse";
	classes: DangerClass[];
	excerpt: string;
}

const RULES: Array<{ class: DangerClass; pattern: RegExp }> = [
	{
		class: "instruction_override",
		pattern: /ignore (?:all |the )?previous (?:instructions|rules)|reveal (?:the |your )?system prompt|you are now/i,
	},
	{ class: "impersonation", pattern: /\bi am the owner\b|\bthe owner (?:already )?approved\b|\bthis is the owner\b/i },
	{ class: "secret_request", pattern: /\.env\b|auth\.json|api[_ -]?key|\btokens?\b|~\/\.trek|system prompt/i },
	{
		class: "tool_request",
		pattern:
			/\b(?:bash|shell)\b|\b(?:run|execute)\s+\S+|\b(?:edit|write|revert)\s+(?:the\s+)?(?:file|files|config|\S+\.\w+)\b|\bcall tools\b|\/confirm/i,
	},
	{ class: "exfiltration", pattern: /\bexfiltrat|\bsend (?:me )?(?:the )?(?:repo|secrets|transcript)\b/i },
	{ class: "safe_mode_off", pattern: /disable safe mode|turn off safe mode|reclassify|you are the owner/i },
];

export function screenGuestInput(text: string, attachmentNames: readonly string[] = []): GuestScreen {
	const raw = [text, ...attachmentNames].join("\n");
	const classes = RULES.filter((rule) => rule.pattern.test(raw)).map((rule) => rule.class);
	return {
		verdict: classes.length > 0 ? "refuse" : "allow",
		classes,
		excerpt: redactExcerpt(raw),
	};
}

export function guestMayUseTools(actor: ChannelActor): boolean {
	return actor === "owner";
}

function redactExcerpt(text: string): string {
	const redacted = text
		.replace(/\b(?:sk|xai|hf|ghp)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, "[redacted]")
		.replace(/\s+/g, " ")
		.trim();
	return redacted.length > 80 ? `${redacted.slice(0, 77)}...` : redacted;
}
