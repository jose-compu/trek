/**
 * Creative Decision Index question packs (Liquid d1 noul / choice / score).
 * One template per prompt kind — assembled into a system_one request.
 */

export type DecisionQuestionType = "noul" | "choice" | "score";

export interface DecisionNoulQuestion {
	type: "noul";
	instructions: string;
	criteria?: Record<string, string>;
}

export interface DecisionChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}

export interface DecisionScoreQuestion {
	type: "score";
	instructions: string;
	criteria: string[];
}

export type DecisionQuestion = DecisionNoulQuestion | DecisionChoiceQuestion | DecisionScoreQuestion;

export interface DecisionPromptTemplate {
	/** Stable id used in logs and cards. */
	id: string;
	/** Short label for humans. */
	title: string;
	/** When this pack should fire (matcher runs on the user turn). */
	match: RegExp;
	/** Prefer solving at Decision when confidence is high enough. */
	solvable: boolean;
	/** How to build `state` for system_one (default: full user text). */
	state?: "full" | "quoted" | "stripped";
	/** Named questions for one forward pass. */
	questions: Record<string, DecisionQuestion>;
	/** Optional witty one-liner shown with · decision · solve. */
	flourish?: string;
}

/** Ladder gate — always available as the default escalate pack. */
export const ROUTE_LADDER_TEMPLATE: DecisionPromptTemplate = {
	id: "route-ladder",
	title: "Compass — which rung answers?",
	match: /.*/,
	solvable: false,
	state: "full",
	flourish: "compass spinning",
	questions: {
		needs_tools: {
			type: "noul",
			instructions:
				"Does this turn require reading, writing, editing files, or running shell commands on the user's machine?",
			criteria: {
				true: "Files, paths, bash, install, or repo work are required",
				false: "Pure judgment, classification, or short structured fact — no tools",
			},
		},
		route: {
			type: "choice",
			instructions: "Pick the Trek hierarchy rung that should own this turn.",
			criteria: {
				solve: "Decision can answer alone: sentiment, yes/no, label, score, or a tiny structured fact",
				tooling: "Mechanical tools — short read/write/edit/bash, typo-scale edits",
				workhorse: "Multi-step build, implement, or non-trivial coding act",
				planning: "Ambiguous design, architecture, or needs a plan before acting",
				frontier: "Hard research, deep debug, or frontier-only reasoning",
			},
		},
		heat: {
			type: "score",
			instructions: "How hot is this request for a coding agent?",
			criteria: [
				"Chill — one glance, no tools",
				"Warm — a quick tool or two",
				"Hot — real coding session",
				"Blazing — plan or frontier territory",
			],
		},
	},
};

export const DECISION_PROMPT_TEMPLATES: DecisionPromptTemplate[] = [
	{
		id: "sentiment-pulse",
		title: "Pulse — mood of the quote",
		match: /\b(?:sentiment|polarity|tone|mood|vibe)\b/i,
		solvable: true,
		state: "quoted",
		flourish: "reading the room",
		questions: {
			sentiment: {
				type: "choice",
				instructions: "What is the emotional polarity of this text?",
				criteria: {
					positive: "Warm, approving, happy, hopeful, or grateful",
					neutral: "Flat, factual, mixed, or no clear lean",
					negative: "Critical, sad, angry, fearful, or dismissive",
				},
			},
			intensity: {
				type: "score",
				instructions: "How strong is that sentiment?",
				criteria: ["Whisper", "Clear", "Emphatic", "On fire"],
			},
			sarcasm: {
				type: "noul",
				instructions: "Is the speaker likely being sarcastic or ironic?",
			},
		},
	},
	{
		id: "yes-no-coin",
		title: "Coin — boolean flip",
		match: /^(?:is |are |was |were |do |does |did |can |could |should |would |will |has |have |am i\b)/i,
		solvable: true,
		state: "full",
		flourish: "coin in the air",
		questions: {
			yes: {
				type: "noul",
				instructions: "Is the truthful answer to the user's yes/no question 'yes'?",
				criteria: {
					true: "Yes / true / affirmative",
					false: "No / false / negative",
				},
			},
			certainty: {
				type: "score",
				instructions: "How certain is that boolean call?",
				criteria: ["Guessing", "Leaning", "Confident", "Slam dunk"],
			},
		},
	},
	{
		id: "label-jar",
		title: "Jar — pick a label",
		match: /\b(?:classify|categorize|label|tag this|which (?:option|category|class|bucket)|pick one|choose between)\b/i,
		solvable: true,
		state: "full",
		flourish: "sorting the jar",
		questions: {
			bucket: {
				type: "choice",
				instructions: "Which single bucket best fits the user's item or text?",
				criteria: {
					code: "Programming, APIs, bugs, or engineering",
					ops: "Deploy, infra, shell, or systems",
					writing: "Prose, docs, copy, or messaging",
					data: "Tables, metrics, JSON, or analytics",
					other: "None of the above",
				},
			},
			fit: {
				type: "score",
				instructions: "How snug is that bucket fit?",
				criteria: ["Loose", "Okay", "Tight", "Perfect"],
			},
		},
	},
	{
		id: "urgency-siren",
		title: "Siren — how urgent?",
		match: /\b(?:urgent|urgency|priority|severity|how bad|how critical|p0|p1|blocker)\b/i,
		solvable: true,
		state: "full",
		flourish: "siren check",
		questions: {
			severity: {
				type: "score",
				instructions: "How severe or urgent is this situation?",
				criteria: ["Can wait for a coffee", "Today would be nice", "Blocking someone now", "Production is on fire"],
			},
			user_blocked: {
				type: "noul",
				instructions: "Is a human currently blocked from making progress?",
			},
		},
	},
	{
		id: "intent-radar",
		title: "Radar — what do they want?",
		match: /\b(?:what (?:do|should) i|help me|i (?:want|need) to|how (?:do|can) i)\b/i,
		solvable: false,
		state: "full",
		flourish: "radar sweep",
		questions: {
			intent: {
				type: "choice",
				instructions: "What is the user's primary intent?",
				criteria: {
					ask: "Learn or understand something",
					act: "Change code, files, or the environment",
					decide: "Pick among options or get a judgment",
					debug: "Find why something failed",
					plan: "Outline steps before doing the work",
				},
			},
			route: {
				type: "choice",
				instructions: "Which Trek rung should take the first swing?",
				criteria: {
					solve: "Decision alone can settle it",
					tooling: "Quick tools",
					workhorse: "Build / implement",
					planning: "Needs a brief plan",
					frontier: "Deep / hard",
				},
			},
		},
	},
	{
		id: "tweet-weather",
		title: "Weather — social snippet",
		match: /\b(?:tweet|twit|toot|post|thread)\b/i,
		solvable: true,
		state: "quoted",
		flourish: "checking the forecast",
		questions: {
			sentiment: {
				type: "choice",
				instructions: "Sentiment of this social post.",
				criteria: {
					positive: "Upbeat or approving",
					neutral: "Informational or mixed",
					negative: "Critical or gloomy",
				},
			},
			topic: {
				type: "choice",
				instructions: "Rough topic of the post.",
				criteria: {
					personal: "Feelings, life, self",
					news: "World or current events",
					product: "App, brand, or tech",
					joke: "Humor or meme",
					other: "Something else",
				},
			},
			shareable: {
				type: "noul",
				instructions: "Would a neutral reader likely reshare this without context?",
			},
		},
	},
	{
		id: "safety-gate",
		title: "Gate — stay on the trail",
		match: /\b(?:hack|exploit|malware|bypass|steal|weapon|bomb|harm)\b/i,
		solvable: true,
		state: "full",
		flourish: "trail gate",
		questions: {
			disallowed: {
				type: "noul",
				instructions: "Does this request ask for clearly harmful or illegal assistance?",
			},
			route: {
				type: "choice",
				instructions: "If the request is allowed, where should it go?",
				criteria: {
					solve: "Refuse or short policy answer at Decision",
					tooling: "Benign tool work",
					workhorse: "Benign coding",
					planning: "Needs careful planning",
					frontier: "Deep but allowed analysis",
				},
			},
		},
	},
	{
		id: "json-shape",
		title: "Mold — answer as JSON",
		match: /\bjson\b/i,
		solvable: true,
		state: "full",
		flourish: "pressing the mold",
		questions: {
			can_structure: {
				type: "noul",
				instructions: "Can a useful JSON object be produced without tools or long prose?",
			},
			shape: {
				type: "choice",
				instructions: "Which JSON shape best matches the ask?",
				criteria: {
					sentiment: "{ sentiment, text, confidence }",
					boolean: "{ answer, confidence }",
					label: "{ label, confidence }",
					score: "{ score, legend }",
					route: "{ route, why }",
					other: "Another compact object",
				},
			},
		},
	},
	ROUTE_LADDER_TEMPLATE,
];

export interface SelectedDecisionTemplate {
	template: DecisionPromptTemplate;
	/** State string for system_one. */
	state: string;
	questions: Record<string, DecisionQuestion>;
}

function quotedSpan(text: string): string | undefined {
	const m = text.match(/["“]([^"”]{1,500})["”]/);
	return m?.[1]?.trim();
}

/** Pick the first matching creative pack (route-ladder is last resort). */
export function selectDecisionTemplate(userText: string): SelectedDecisionTemplate {
	const text = userText.trim();
	const template =
		DECISION_PROMPT_TEMPLATES.find((t) => t.id !== "route-ladder" && t.match.test(text)) ?? ROUTE_LADDER_TEMPLATE;
	let state = text;
	if (template.state === "quoted") {
		state = quotedSpan(text) ?? text;
	} else if (template.state === "stripped") {
		state = text.replace(/^(?:please\s+)?/i, "").trim();
	}
	return { template, state, questions: template.questions };
}

/** Build the Liquid / local system_one body for one user turn. */
export function buildDecisionRequest(userText: string): {
	templateId: string;
	title: string;
	flourish?: string;
	solvable: boolean;
	state: string;
	questions: Record<string, DecisionQuestion>;
} {
	const selected = selectDecisionTemplate(userText);
	return {
		templateId: selected.template.id,
		title: selected.template.title,
		flourish: selected.template.flourish,
		solvable: selected.template.solvable,
		state: selected.state,
		questions: selected.questions,
	};
}

/** Pretty JSON example for docs / ESCALATE_PROMPTS. */
export function formatDecisionTemplateExample(template: DecisionPromptTemplate, sampleState: string): string {
	return JSON.stringify(
		{
			model: "LiquidAI/d1-omni-600M",
			template: template.id,
			title: template.title,
			flourish: template.flourish,
			state: sampleState,
			questions: template.questions,
		},
		null,
		2,
	);
}

/** Invented pack from Tooling when no canned template fits. */
export interface InventedDecisionTemplate {
	id: string;
	title: string;
	flourish?: string;
	solvable: boolean;
	state: string;
	questions: Record<string, DecisionQuestion>;
	/** Question name that holds the user-facing answer. */
	primary: string;
}

const ID_OK = /^[a-z][a-z0-9-]{1,40}$/;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseQuestion(raw: unknown): DecisionQuestion | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const q = raw as Record<string, unknown>;
	const type = asString(q.type)?.toLowerCase();
	const instructions = asString(q.instructions);
	if (!type || !instructions) {
		return undefined;
	}
	if (type === "noul") {
		const criteria =
			q.criteria && typeof q.criteria === "object" && !Array.isArray(q.criteria)
				? (q.criteria as Record<string, string>)
				: undefined;
		return { type: "noul", instructions, criteria };
	}
	if (type === "choice") {
		if (!q.criteria || typeof q.criteria !== "object" || Array.isArray(q.criteria)) {
			return undefined;
		}
		const criteria = q.criteria as Record<string, string>;
		const keys = Object.keys(criteria);
		if (keys.length < 2 || keys.length > 12) {
			return undefined;
		}
		return { type: "choice", instructions, criteria };
	}
	if (type === "score") {
		if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
			return undefined;
		}
		const criteria = q.criteria.map((c) => String(c)).filter(Boolean);
		if (criteria.length < 2) {
			return undefined;
		}
		return { type: "score", instructions, criteria };
	}
	return undefined;
}

/** Extract the first JSON object from a Tooling reply. */
export function extractJsonObject(text: string): unknown | undefined {
	const trimmed = text.trim();
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const body = fence?.[1]?.trim() ?? trimmed;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) {
		return undefined;
	}
	try {
		return JSON.parse(body.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

/**
 * Validate a Tooling-invented Decision pack.
 * Rejects junk so we never feed garbage into d1 / heuristics.
 */
export function parseInventedDecisionTemplate(
	raw: unknown,
	fallbackState: string,
): InventedDecisionTemplate | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const id = asString(obj.id)
		?.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-");
	const title = asString(obj.title);
	if (!id || !ID_OK.test(id) || !title) {
		return undefined;
	}
	const questionsRaw = obj.questions;
	if (!questionsRaw || typeof questionsRaw !== "object" || Array.isArray(questionsRaw)) {
		return undefined;
	}
	const questions: Record<string, DecisionQuestion> = {};
	for (const [name, value] of Object.entries(questionsRaw as Record<string, unknown>)) {
		if (!/^[a-z][a-z0-9_]{0,32}$/i.test(name)) {
			continue;
		}
		const parsed = parseQuestion(value);
		if (parsed) {
			questions[name] = parsed;
		}
	}
	const names = Object.keys(questions);
	if (names.length < 1 || names.length > 6) {
		return undefined;
	}
	const primaryHint = asString(obj.primary)?.toLowerCase();
	const primary =
		(primaryHint && questions[primaryHint] ? primaryHint : undefined) ??
		names.find((n) => questions[n]?.type === "choice") ??
		names.find((n) => questions[n]?.type === "noul") ??
		names[0]!;
	const state = asString(obj.state) ?? fallbackState;
	const solvable = obj.solvable !== false;
	return {
		id: id.slice(0, 40),
		title: title.slice(0, 80),
		flourish: asString(obj.flourish)?.slice(0, 48),
		solvable,
		state: state.slice(0, 2000),
		questions,
		primary,
	};
}

/** True when canned packs are missing or too generic for a no-tool turn. */
export function needsInventedTemplate(userText: string, selectedId: string, toolingNeeded: boolean): boolean {
	if (toolingNeeded) {
		return false;
	}
	const text = userText.trim();
	if (!text || text.length < 8) {
		return false;
	}
	// Default compass only — invent a bespoke pack.
	if (selectedId === "route-ladder") {
		return true;
	}
	// Matched a creative pack but still need custom criteria / structure.
	if (selectedId === "label-jar" || selectedId === "json-shape" || selectedId === "intent-radar") {
		return true;
	}
	return false;
}

/** Prompt for Tooling: invent one Decision Index JSON pack. */
export function decisionTemplateInventPrompt(userText: string): string {
	return `You invent ONE Liquid Decision Model (d1) question pack for Trek.
Reply with JSON only. No markdown, no tools, no prose.

The pack must help answer or route this user turn WITHOUT reading or writing files:

<<<
${userText.trim().slice(0, 1200)}
>>>

Schema:
{
  "id": "kebab-case-id",
  "title": "Short Name — witty subtitle",
  "flourish": "3-5 word vibe for the console card",
  "solvable": true,
  "state": "the text or fact d1 should judge (quote if present)",
  "primary": "name of the main answer question",
  "questions": {
    "<name>": {
      "type": "noul" | "choice" | "score",
      "instructions": "clear question for d1",
      "criteria": { "opt": "desc" }   // choice: 2-8 options
                                   // score: ["low", "...", "high"] 2-6 levels
                                   // noul: optional {"true":"...","false":"..."}
    }
  }
}

Rules:
- Be creative with id/title/flourish (spice, compass, weather, coin, jar, radar, …).
- 1 to 4 questions. Always include a primary choice or noul that answers the user.
- If the user wants JSON, primary choice/noul labels should map cleanly into a small object.
- If the turn clearly needs coding tools, set "solvable": false and add a choice "route" with solve|tooling|workhorse|planning.
- Never invent file paths. Never ask for bash.`;
}
