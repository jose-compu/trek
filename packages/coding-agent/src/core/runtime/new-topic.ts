/**
 * Detect when the user resets the topic/task so the ladder can descalate
 * back to Decision (lowest), then route Tooling for the new generative turn.
 *
 * Stickiness: same-topic follow-ups keep the climbed floor. A reset must be
 * explicit, signaled, or clearly a different intent (low overlap / done→new).
 */

export type TopicResetReason = "first" | "explicit" | "signal" | "low-overlap" | "done-then-new" | "intent-shift";

export interface TopicReset {
	reset: boolean;
	reason?: TopicResetReason;
	/** Short label for the ↓ Decision card. */
	label?: string;
}

/** Model or user control line: switch task → Decision floor. */
const NEW_TOPIC_JSON = /\{\s*"new_topic"\s*:\s*true\s*(?:,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?\s*\}/is;

const NEW_TOPIC_LOOSE = /"?new_topic"?\s*:\s*true(?:\s*,\s*"why"\s*:\s*"((?:\\.|[^"\\])*)")?/i;

const EXPLICIT_NEW =
	/^(?:\/(?:new-topic|reset-topic|topic|reset)\b|new(?:\s+(?:task|topic|thread))?(?:\s*[(:–—-]|\b)|different (?:topic|task|subject)|unrelated(?:\s+task)?|start over|forget (?:that|the last|previous)|switching (?:to|topics?|tasks?)|another (?:task|topic)|by the way[,:]?\s+(?!also)|never ?mind (?:that|the)|scrap (?:that|it)|abandon (?:that|it)|cancel (?:that|the) task|instead[,:]?\s+let(?:'| u)?s|ok(?:ay)?[,.]?\s+new (?:task|topic)|change of (?:topic|task|subject))\b/i;

const CONTINUATION =
	/^(?:also|and then|then |now (?:please |just )?(?:fix|add|update|change|make|do)|ok[,.]|okay[,.]|yes|yep|no|nope|continue|retry|try again|fix (?:that|it)|do it|same |go ahead|please (?:do|fix|continue)|make it|change it|update it|the (?:file|bug|error|typo|same))\b/i;

const SHORT_REF = /\b(?:it|that|this|those|same|again|instead)\b/i;

const DONE_CLOSE =
	/\b(?:thanks|thank you|that(?:'s| is) (?:all|it|done|fine)|(?:all )?done\.?|finished|ship it|lgtm|looks good|perfect\.?|great[,.]?\s*thanks)\s*$/i;

const IMPERATIVE =
	/^(?:please\s+)?(?:write|create|build|fix|make|add|implement|run|open|list|show|explain|design|refactor|delete|remove|install|deploy|test|check|debug|what|how|why|can you|could you|help me)\b/i;

const LABEL: Record<TopicResetReason, string> = {
	first: "new session",
	explicit: "new topic",
	signal: "new topic signal",
	"low-overlap": "new topic",
	"done-then-new": "task done",
	"intent-shift": "task changed",
};

function tokens(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
		out.add(raw);
	}
	return out;
}

function files(text: string): Set<string> {
	return new Set((text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8}/g) ?? []).map((f) => f.toLowerCase()));
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) {
		return 1;
	}
	if (a.size === 0 || b.size === 0) {
		return 0;
	}
	let inter = 0;
	for (const t of a) {
		if (b.has(t)) {
			inter += 1;
		}
	}
	return inter / (a.size + b.size - inter);
}

function hit(reason: TopicResetReason): TopicReset {
	return { reset: true, reason, label: LABEL[reason] };
}

/** Parse explicit `{"new_topic":true}` from user or model text. */
export function parseNewTopicSignal(text: string): { why: string } | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	const match = trimmed.match(NEW_TOPIC_JSON) ?? trimmed.match(NEW_TOPIC_LOOSE);
	if (!match) {
		return undefined;
	}
	const why = (match[1] ?? "").replace(/\\"/g, '"').trim() || "new topic";
	return { why };
}

/** Strip new-topic control JSON so the model does not see the control line. */
export function stripNewTopicSignal(text: string): string {
	return text
		.replace(NEW_TOPIC_JSON, "")
		.replace(NEW_TOPIC_LOOSE, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Decide whether `next` resets the active task relative to `previous`.
 * First prompt of a session (`previous` empty) is always a reset.
 */
export function detectTopicReset(previous: string, next: string): TopicReset {
	const prev = previous.trim();
	const curr = next.trim();
	if (!curr) {
		return { reset: false };
	}
	if (!prev) {
		return hit("first");
	}
	if (parseNewTopicSignal(curr)) {
		return hit("signal");
	}
	if (EXPLICIT_NEW.test(curr)) {
		return hit("explicit");
	}
	if (CONTINUATION.test(curr)) {
		return { reset: false };
	}

	const prevFiles = files(prev);
	const currFiles = [...files(curr)];
	const sharedFile = currFiles.some((f) => prevFiles.has(f));
	if (sharedFile) {
		return { reset: false };
	}

	if (curr.length < 48 && SHORT_REF.test(curr)) {
		return { reset: false };
	}

	const overlap = jaccard(tokens(prev), tokens(curr));
	const currImperative = IMPERATIVE.test(curr);

	// Prior turn looked finished; this prompt starts a new imperative.
	if (DONE_CLOSE.test(prev) && currImperative && overlap < 0.35) {
		return hit("done-then-new");
	}

	// Short, zero-overlap imperative with no anaphora → new task.
	if (currImperative && overlap === 0 && curr.length >= 12 && !SHORT_REF.test(curr)) {
		return hit("intent-shift");
	}

	// Both look like tasks, no shared files, weak lexical overlap.
	if (currImperative && IMPERATIVE.test(prev) && overlap < 0.18 && curr.length >= 16) {
		return hit("intent-shift");
	}

	if (curr.length >= 24 && overlap < 0.12) {
		return hit("low-overlap");
	}
	if (curr.length >= 80 && overlap < 0.2) {
		return hit("low-overlap");
	}
	return { reset: false };
}

/**
 * True when `next` looks like a fresh task relative to `previous`.
 * Prefer {@link detectTopicReset} when the reason label is needed.
 */
export function isNewTopic(previous: string, next: string): boolean {
	return detectTopicReset(previous, next).reset;
}
