/**
 * Decision Index (LFM d1 contract): before Tooling binds, classify the turn.
 * - solve — answer at Decision (no chat tokens from d1; structured reply here)
 * - escalate — bind Tooling (or a higher ladder floor when requested)
 *
 * Prefer Liquid Decision API when LIQUID_API_KEY is set. Otherwise use a
 * local heuristic index so trivial classify/sentiment/yes-no work stays on
 * Decision instead of always routing to Tooling.
 */

import {
	buildDecisionRequest,
	type DecisionQuestion,
	extractJsonObject,
	type InventedDecisionTemplate,
	needsInventedTemplate,
	parseInventedDecisionTemplate,
	selectDecisionTemplate,
} from "./decision-templates.ts";
import type { LadderRole } from "./escalate.ts";
import { roleAvailable, startLadderRole } from "./escalate.ts";
import type { ResolvedRuntime } from "./resolve.ts";

export type DecisionOutcome = "solve" | "escalate";

export interface DecisionIndexResult {
	outcome: DecisionOutcome;
	/** Ladder floor when escalating (never decision). */
	route?: LadderRole;
	why: string;
	/** Structured answer when outcome is solve. */
	answer?: string;
	confidence?: number;
	source: "heuristic" | "liquid-api" | "tooling-invent";
	/** Invented template id when Tooling drafted the pack. */
	templateId?: string;
}

/** Optional Tooling side-call that returns raw JSON text for an invented pack. */
export type InventDecisionTemplateFn = (userText: string) => Promise<string | undefined>;

const NEEDS_TOOLS =
	/\b(?:write|edit|read|bash|create|build|implement|refactor|install|deploy|scaffold|commit|push|pull|clone|mkdir|touch|rm |delete file|open (?:the )?(?:file|browser)|run (?:the )?(?:tests?|server|command)|fix (?:the )?(?:bug|typo|code|file)|add (?:a )?(?:function|file|test)|modify|patch)\b/i;

const FILE_PATH = /(?:^|[\s`"'(])((?:\.\/|~\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]{1,8})\b/;

const SENTIMENT_ASK = /\b(?:sentiment|polarity|tone|mood)\b/i;

const YES_NO_ASK = /^(?:is |are |was |were |do |does |did |can |could |should |would |will |has |have |am i\b)/i;

const CLASSIFY_ASK = /\b(?:classify|categorize|label|which (?:option|category|class)|pick one|choose between)\b/i;

const POS =
	/\b(?:good|great|love|loved|amazing|wonderful|excellent|happy|glad|awesome|fantastic|positive|best|nice|beautiful|joy|grateful|thank)\b/i;
const NEG =
	/\b(?:bad|hate|awful|terrible|horrible|sad|angry|worst|negative|disgusting|hate|sucks|broken|fail|failed|miserable|tragic)\b/i;

function quotedSpan(text: string): string | undefined {
	const m = text.match(/["“]([^"”]{1,500})["”]/);
	return m?.[1]?.trim();
}

function classifySentimentLabel(body: string): { label: "positive" | "negative" | "neutral"; confidence: number } {
	const pos = (body.match(POS) ?? []).length;
	const neg = (body.match(NEG) ?? []).length;
	if (pos > neg) {
		return { label: "positive", confidence: Math.min(0.95, 0.55 + 0.1 * (pos - neg)) };
	}
	if (neg > pos) {
		return { label: "negative", confidence: Math.min(0.95, 0.55 + 0.1 * (neg - pos)) };
	}
	return { label: "neutral", confidence: 0.55 };
}

function trySolveSentiment(text: string): DecisionIndexResult | undefined {
	if (!SENTIMENT_ASK.test(text)) {
		return undefined;
	}
	const body = quotedSpan(text) ?? text.replace(/^.*?\bsentiment\b[:\s]*/i, "").trim();
	if (!body || body.length > 500) {
		return undefined;
	}
	// Still needs tools if they also ask to write a file.
	if (NEEDS_TOOLS.test(text) && FILE_PATH.test(text)) {
		return undefined;
	}
	const { label, confidence } = classifySentimentLabel(body);
	const wantJson = /\bjson\b/i.test(text);
	const payload = { sentiment: label, text: body, confidence };
	const answer = wantJson
		? `${JSON.stringify(payload, null, 2)}\n`
		: `Sentiment: ${label} (confidence ${confidence.toFixed(2)})`;
	return {
		outcome: "solve",
		why: "sentiment",
		answer: answer.trimEnd(),
		confidence,
		source: "heuristic",
	};
}

function trySolveYesNo(text: string): DecisionIndexResult | undefined {
	const trimmed = text.trim();
	if (!YES_NO_ASK.test(trimmed) || trimmed.length > 200) {
		return undefined;
	}
	if (NEEDS_TOOLS.test(trimmed) || FILE_PATH.test(trimmed)) {
		return undefined;
	}
	// Lexical lean only — uncertain → escalate.
	const pos = POS.test(trimmed);
	const neg = NEG.test(trimmed);
	if (pos === neg) {
		return undefined;
	}
	const yes = pos && !neg;
	const payload = { answer: yes ? "yes" : "no", confidence: 0.6 };
	return {
		outcome: "solve",
		why: "yes/no",
		answer: JSON.stringify(payload, null, 2),
		confidence: 0.6,
		source: "heuristic",
	};
}

function needsTooling(text: string): boolean {
	if (FILE_PATH.test(text) && NEEDS_TOOLS.test(text)) {
		return true;
	}
	if (/\b(?:in (?:the )?(?:repo|project|codebase)|on disk|this (?:folder|directory|file))\b/i.test(text)) {
		return true;
	}
	if (NEEDS_TOOLS.test(text)) {
		return true;
	}
	return false;
}

function escalateResult(resolved: ResolvedRuntime, why: string, route?: LadderRole): DecisionIndexResult {
	const floor = route && roleAvailable(resolved, route) ? route : startLadderRole(resolved);
	return {
		outcome: "escalate",
		route: floor,
		why,
		source: "heuristic",
	};
}

/** Liquid Decision API (hosted d1.1 / d1-ultra). Zero output tokens. */
export async function liquidSystemOne(input: {
	state: string;
	questions: Record<string, unknown>;
	apiKey: string;
	model?: string;
	timeoutMs?: number;
}): Promise<{ answers: Record<string, unknown>; usage?: { input_tokens?: number; output_tokens?: number } }> {
	const model = input.model ?? "d1.1";
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 12_000);
	try {
		const response = await fetch("https://api.liquid.ai/decisions/v1/systemone", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${input.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				state: input.state,
				questions: input.questions,
			}),
			signal: controller.signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Liquid Decision API ${response.status}: ${body.slice(0, 200)}`);
		}
		return (await response.json()) as {
			answers: Record<string, unknown>;
			usage?: { input_tokens?: number; output_tokens?: number };
		};
	} finally {
		clearTimeout(timer);
	}
}

function scoreChoice(state: string, criteria: Record<string, string>): { choice: string; confidence: number } {
	const hay = state.toLowerCase();
	let best = Object.keys(criteria)[0]!;
	let bestScore = -1;
	for (const [name, desc] of Object.entries(criteria)) {
		const words = `${name} ${desc}`.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
		let hit = 0;
		for (const w of words) {
			if (hay.includes(w)) {
				hit += 1;
			}
		}
		const score = hit + (hay.includes(name.toLowerCase()) ? 2 : 0);
		if (score > bestScore) {
			bestScore = score;
			best = name;
		}
	}
	const confidence = bestScore <= 0 ? 0.45 : Math.min(0.92, 0.5 + 0.08 * bestScore);
	return { choice: best, confidence };
}

function scoreNoul(state: string, question: DecisionQuestion): number {
	const hay = state.toLowerCase();
	const pos = /\b(?:yes|true|good|ok|okay|positive|love|great)\b/i.test(hay);
	const neg = /\b(?:no|false|bad|not|never|negative|hate)\b/i.test(hay);
	void question;
	if (pos && !neg) {
		return 0.78;
	}
	if (neg && !pos) {
		return 0.22;
	}
	return 0.5;
}

function scoreLevels(state: string, levels: string[]): number {
	const { choice } = scoreChoice(state, Object.fromEntries(levels.map((level, i) => [String(i), level])));
	return Number(choice) || 0;
}

/** Apply an invented (or canned) question pack without Liquid — lexical fill. */
export function applyDecisionQuestions(
	state: string,
	questions: Record<string, DecisionQuestion>,
	primary: string,
): { answers: Record<string, unknown>; primaryValue: unknown; confidence?: number } {
	const answers: Record<string, unknown> = {};
	for (const [name, q] of Object.entries(questions)) {
		if (q.type === "choice") {
			const { choice, confidence } = scoreChoice(state, q.criteria);
			answers[name] = { type: "choice", choice, confidence };
		} else if (q.type === "noul") {
			const noul = scoreNoul(state, q);
			answers[name] = { type: "noul", noul };
		} else {
			const score = scoreLevels(state, q.criteria);
			answers[name] = { type: "score", score, legend: q.criteria };
		}
	}
	const primaryAnswer = answers[primary] as Record<string, unknown> | undefined;
	let primaryValue: unknown = primaryAnswer;
	let confidence: number | undefined;
	if (primaryAnswer?.type === "choice") {
		primaryValue = primaryAnswer.choice;
		confidence = typeof primaryAnswer.confidence === "number" ? primaryAnswer.confidence : undefined;
	} else if (primaryAnswer?.type === "noul") {
		const noul = Number(primaryAnswer.noul);
		primaryValue = noul >= 0.5 ? "yes" : "no";
		confidence = Math.abs(noul - 0.5) * 2;
	} else if (primaryAnswer?.type === "score") {
		primaryValue = primaryAnswer.score;
		confidence = 0.55;
	}
	return { answers, primaryValue, confidence };
}

function formatInventedSolve(
	invented: InventedDecisionTemplate,
	answers: Record<string, unknown>,
	primaryValue: unknown,
	confidence: number | undefined,
	wantJson: boolean,
	source: DecisionIndexResult["source"],
): DecisionIndexResult {
	const payload = {
		template: invented.id,
		title: invented.title,
		flourish: invented.flourish,
		state: invented.state,
		primary: invented.primary,
		answer: primaryValue,
		confidence,
		answers,
	};
	return {
		outcome: "solve",
		why: invented.flourish ?? invented.id,
		answer: wantJson ? JSON.stringify(payload, null, 2) : `${invented.title}: ${String(primaryValue)}`,
		confidence,
		source,
		templateId: invented.id,
	};
}

async function tryLiquidQuestions(
	state: string,
	questions: Record<string, DecisionQuestion>,
	apiKey: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		const result = await liquidSystemOne({
			apiKey,
			state,
			questions: questions as Record<string, unknown>,
		});
		return result.answers;
	} catch {
		return undefined;
	}
}

async function tryInventedPath(
	text: string,
	resolved: ResolvedRuntime,
	inventTemplate: InventDecisionTemplateFn,
	apiKey?: string,
): Promise<DecisionIndexResult | undefined> {
	const raw = await inventTemplate(text);
	if (!raw?.trim()) {
		return undefined;
	}
	const invented = parseInventedDecisionTemplate(extractJsonObject(raw), text);
	if (!invented) {
		return undefined;
	}
	if (!invented.solvable) {
		const routeQ = invented.questions.route;
		if (routeQ?.type === "choice") {
			const { choice } = scoreChoice(invented.state, routeQ.criteria);
			if (choice === "tooling" || choice === "workhorse" || choice === "planning" || choice === "frontier") {
				return {
					outcome: "escalate",
					route: choice,
					why: `${invented.id} → ${choice}`,
					source: "tooling-invent",
					templateId: invented.id,
				};
			}
		}
		return escalateResult(resolved, `${invented.id}: not solvable`);
	}

	let answers: Record<string, unknown> | undefined;
	let source: DecisionIndexResult["source"] = "tooling-invent";
	if (apiKey) {
		answers = await tryLiquidQuestions(invented.state, invented.questions, apiKey);
		if (answers) {
			source = "liquid-api";
		}
	}
	if (!answers) {
		const applied = applyDecisionQuestions(invented.state, invented.questions, invented.primary);
		return formatInventedSolve(
			invented,
			applied.answers,
			applied.primaryValue,
			applied.confidence,
			/\bjson\b/i.test(text),
			"tooling-invent",
		);
	}

	const primaryAnswer = answers[invented.primary] as Record<string, unknown> | undefined;
	let primaryValue: unknown = primaryAnswer;
	let confidence: number | undefined;
	if (primaryAnswer && "choice" in primaryAnswer) {
		primaryValue = primaryAnswer.choice;
		confidence = typeof primaryAnswer.confidence === "number" ? primaryAnswer.confidence : undefined;
	} else if (primaryAnswer && "noul" in primaryAnswer) {
		const noul = Number(primaryAnswer.noul);
		primaryValue = noul >= 0.5 ? "yes" : "no";
		confidence = Math.abs(noul - 0.5) * 2;
	} else if (primaryAnswer && "score" in primaryAnswer) {
		primaryValue = primaryAnswer.score;
	}
	return formatInventedSolve(invented, answers, primaryValue, confidence, /\bjson\b/i.test(text), source);
}

async function tryLiquidTemplate(
	text: string,
	resolved: ResolvedRuntime,
	apiKey: string,
): Promise<DecisionIndexResult | undefined> {
	const request = buildDecisionRequest(text);
	try {
		const result = await liquidSystemOne({
			apiKey,
			state: request.state,
			questions: request.questions as Record<string, unknown>,
		});
		const answers = result.answers;

		const sentiment = answers.sentiment as
			| { choice?: string; confidence?: number; probabilities?: Record<string, number> }
			| undefined;
		if (sentiment?.choice && request.solvable) {
			const intensity = answers.intensity as { score?: number } | undefined;
			const sarcasm = answers.sarcasm as { noul?: number } | undefined;
			const payload = {
				template: request.templateId,
				title: request.title,
				sentiment: sentiment.choice,
				text: request.state,
				confidence: sentiment.confidence ?? sentiment.probabilities?.[sentiment.choice],
				probabilities: sentiment.probabilities,
				intensity: intensity?.score,
				sarcasm: sarcasm?.noul,
			};
			const wantJson = /\bjson\b/i.test(text);
			return {
				outcome: "solve",
				why: request.flourish ?? request.templateId,
				answer: wantJson
					? JSON.stringify(payload, null, 2)
					: `Sentiment: ${sentiment.choice} (confidence ${Number(payload.confidence ?? 0).toFixed(2)})`,
				confidence: typeof payload.confidence === "number" ? payload.confidence : undefined,
				source: "liquid-api",
				templateId: request.templateId,
			};
		}

		const yes = answers.yes as { noul?: number } | undefined;
		if (typeof yes?.noul === "number" && request.templateId === "yes-no-coin") {
			const payload = {
				template: request.templateId,
				answer: yes.noul >= 0.5 ? "yes" : "no",
				confidence: Math.abs(yes.noul - 0.5) * 2,
				noul: yes.noul,
			};
			return {
				outcome: "solve",
				why: request.flourish ?? "yes/no",
				answer: JSON.stringify(payload, null, 2),
				confidence: payload.confidence,
				source: "liquid-api",
				templateId: request.templateId,
			};
		}

		const routeAnswer = answers.route as { choice?: string; confidence?: number } | undefined;
		const choice = routeAnswer?.choice?.toLowerCase();
		if (choice === "solve") {
			const local = trySolveSentiment(text) ?? trySolveYesNo(text);
			if (local) {
				return {
					...local,
					why: request.flourish ?? local.why,
					source: "liquid-api",
					confidence: routeAnswer?.confidence ?? local.confidence,
					templateId: request.templateId,
				};
			}
			return escalateResult(resolved, `${request.templateId}: solve → tooling`);
		}
		if (choice === "tooling" || choice === "workhorse" || choice === "planning" || choice === "frontier") {
			return {
				outcome: "escalate",
				route: choice,
				why: `${request.templateId} → ${choice}`,
				confidence: routeAnswer?.confidence,
				source: "liquid-api",
				templateId: request.templateId,
			};
		}

		const needsTools = answers.needs_tools as { noul?: number } | undefined;
		if (typeof needsTools?.noul === "number" && needsTools.noul >= 0.55) {
			return escalateResult(resolved, `${request.templateId}: needs tools`);
		}
	} catch {
		return undefined;
	}
	return undefined;
}

/**
 * Run the Decision Index for one user turn.
 * Same-topic stickiness is the caller's job — only invoke on Decision floor / new topic.
 * When no canned pack fits, optional `inventTemplate` asks Tooling to draft one.
 */
export async function runDecisionIndex(input: {
	text: string;
	resolved: ResolvedRuntime;
	apiKey?: string;
	inventTemplate?: InventDecisionTemplateFn;
}): Promise<DecisionIndexResult> {
	const text = input.text.trim();
	if (!text) {
		return escalateResult(input.resolved, "empty");
	}

	const selected = selectDecisionTemplate(text);
	const apiKey = input.apiKey ?? process.env.LIQUID_API_KEY?.trim();
	if (apiKey) {
		const fromTemplate = await tryLiquidTemplate(text, input.resolved, apiKey);
		if (fromTemplate) {
			return fromTemplate;
		}
	}

	const sentiment = trySolveSentiment(text);
	if (sentiment) {
		return {
			...sentiment,
			why: selected.template.flourish ?? selected.template.id,
			templateId: selected.template.id,
		};
	}
	const tooling = needsTooling(text);
	if (!tooling) {
		const yesNo = trySolveYesNo(text);
		if (yesNo) {
			return {
				...yesNo,
				why: selected.template.flourish ?? selected.template.id,
				templateId: selected.template.id,
			};
		}
	}

	if (tooling) {
		return escalateResult(input.resolved, `${selected.template.id}: needs tools`);
	}

	if (input.inventTemplate && needsInventedTemplate(text, selected.template.id, tooling)) {
		const invented = await tryInventedPath(text, input.resolved, input.inventTemplate, apiKey);
		if (invented) {
			return invented;
		}
	}

	if (CLASSIFY_ASK.test(text) && quotedSpan(text)) {
		return escalateResult(input.resolved, `${selected.template.id}: classify → tooling`);
	}
	return escalateResult(input.resolved, selected.template.id);
}

/** One-line console card when Decision answers without climbing. */
export function formatDecisionSolveCard(why?: string): string {
	const reason = why?.trim() ? ` · ${why.trim().slice(0, 48)}` : "";
	return `· decision · solve${reason}`;
}
