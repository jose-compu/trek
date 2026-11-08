#!/usr/bin/env node
/**
 * One-shot: download Grok chat completions into layering fixtures.
 * Not a CI test. Requires XAI_API_KEY. Does not print the key.
 *
 *   set -a && . ../../.env && set +a && node scripts/capture-xai-layering.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../test/suite/layering/fixtures/xai");
const key = process.env.XAI_API_KEY?.trim();
if (!key) {
	console.error("XAI_API_KEY missing");
	process.exit(1);
}

const SYSTEM = `The chat ladder is Workhorse ⇄ Planning ⇄ Frontier. Tooling is a runner, not a rung.
You are on this computer. You have read, write, edit, and bash. bash may use the network.
When the task is beyond you, emit one JSON line and stop tool calls for that step:
{"escalate":"next","why":"short reason"}
Or name a higher tier: "planning" or "frontier".
To send a search/logs/fetch job to Tooling without leaving your tier:
{"action":"delegate","target":"tooling","reason":"short reason"}
When remaining work is clearly below your tier, emit:
{"descalate":"workhorse","why":"short reason"}
Do not paste a tutorial. Prefer a short plan or a single JSON control line when that is the job.`;

const CASES = [
	{
		role: "workhorse",
		pack: "stay-calc",
		model: "grok-4.3",
		prompt:
			"Create src/calc.ts with add(a,b) and a one-line test. Do not plan. One file, one test.",
	},
	{
		role: "tooling",
		pack: "live-weather",
		model: "grok-4.1-fast",
		prompt:
			"What is the weather in Paris right now? Fetch a live source with curl. Do not invent the temperature.",
	},
	{
		role: "tooling",
		pack: "grep-log",
		model: "grok-4.1-fast",
		prompt: "grep the log for the last TypeError and summarize the failing path. Search only.",
	},
	{
		role: "planning",
		pack: "race-debug",
		model: "grok-4.5",
		prompt:
			"The same edit failed twice. Root cause is still unclear. Debug the race in a concurrent queue: writers corrupt a shared map, tests flake only under load. Write a plan, then hypotheses, then one failing reproduction. Escalate to planning with a handoff.",
	},
	{
		role: "frontier",
		pack: "consult-migrate",
		model: "grok-4.20-multi-agent",
		prompt:
			"consult frontier. Architect a zero-downtime migration from a single-node SQLite ledger to Postgres with dual-write, cutover, and rollback. Consult only. Do not edit files yet.",
	},
	{
		role: "workhorse",
		pack: "mechanical-rename",
		model: "grok-4.3",
		prompt:
			"format json in package.json with prettier. Rename the symbol fooBar to foo_bar with sed. No design.",
	},
	{
		role: "workhorse",
		pack: "defect-fix-escalate",
		model: "grok-4.3",
		prompt:
			"The lint error is in src/foo.ts. Escalate to planning with a handoff. Fix the defect, then draft review the diff.",
	},
	{
		role: "workhorse",
		pack: "capability-net",
		model: "grok-4.3",
		prompt: "do you have internet access?",
	},
	{
		role: "workhorse",
		pack: "http-server",
		model: "grok-4.3",
		prompt:
			"Add index.html that loads main.js. Start it with python3 -m http.server 8765. Then stop the server and fix any 404.",
	},
	{
		role: "workhorse",
		pack: "tetris-build",
		model: "grok-4.3",
		prompt: "please build a tetris game in js and start locally, first do the Plan",
	},
	{
		role: "workhorse",
		pack: "descalate-workhorse",
		model: "grok-4.3",
		prompt: "descalate to workhorse.",
	},
	{
		role: "workhorse",
		pack: "new-topic-haiku",
		model: "grok-4.3",
		prompt: "new task: write a haiku about rain in /tmp/trek-layer-tlLVha/rain.txt.",
	},
	{
		role: "workhorse",
		pack: "go-back-to-decision",
		model: "grok-4.3",
		prompt: "go back to decision",
	},
	{
		role: "planning",
		pack: "use-planning",
		model: "grok-4.5",
		prompt: "use planning",
	},
	{
		role: "planning",
		pack: "plan-done-descalate",
		model: "grok-4.5",
		prompt:
			"The plan is done. Remaining work is a one-line typo rename. descalate to workhorse.",
	},
	{
		role: "frontier",
		pack: "move-to-frontier",
		model: "grok-4.20-multi-agent",
		prompt: "move to frontier model",
	},
	{
		role: "decision",
		pack: "format-yes-no",
		model: "grok-4.1-fast",
		prompt: "Should we format package.json with the repo prettier recipe?",
	},
];

const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const selected = only.length
	? CASES.filter((item) => only.includes(item.pack) || only.includes(`${item.role}/${item.pack}`))
	: CASES;
if (only.length && selected.length === 0) {
	console.error(`no packs matched: ${only.join(", ")}`);
	process.exit(1);
}

async function complete(model, prompt) {
	const body = {
		model,
		temperature: 0,
		max_tokens: 900,
		messages: [
			{ role: "system", content: SYSTEM },
			{ role: "user", content: prompt },
		],
	};
	const res = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const json = await res.json();
	if (!res.ok) {
		const err = json?.error?.message ?? JSON.stringify(json).slice(0, 240);
		throw new Error(`${model} HTTP ${res.status}: ${err}`);
	}
	const content = json?.choices?.[0]?.message?.content;
	if (typeof content !== "string") {
		throw new Error(`${model} missing choices[0].message.content`);
	}
	return {
		choices: [{ message: { role: "assistant", content } }],
	};
}

const results = await Promise.allSettled(
	selected.map(async (item) => {
		console.log(`capture ${item.role}/${item.pack} model=${item.model}`);
		try {
			return { ...item, envelope: await complete(item.model, item.prompt) };
		} catch (err) {
			const fallback =
				item.model === "grok-4.20-multi-agent"
					? "grok-4.5"
					: item.model === "grok-4.1-fast"
						? "grok-4.3"
						: undefined;
			if (fallback) {
				console.log(`  fallback ${fallback} after ${err instanceof Error ? err.message : err}`);
				return { ...item, model: fallback, envelope: await complete(fallback, item.prompt) };
			}
			throw err;
		}
	}),
);

let failed = 0;
for (const [index, result] of results.entries()) {
	const item = selected[index];
	if (result.status === "rejected") {
		failed += 1;
		console.error(`FAIL ${item.role}/${item.pack}: ${result.reason}`);
		continue;
	}
	const dir = join(root, result.value.role, result.value.pack);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "prompt.txt"), `${result.value.prompt}\n`);
	writeFileSync(join(dir, "response.json"), `${JSON.stringify(result.value.envelope, null, "\t")}\n`);
	const content = result.value.envelope.choices[0].message.content;
	console.log(
		`OK ${result.value.role}/${result.value.pack} model=${result.value.model} chars=${content.length} preview=${JSON.stringify(content.slice(0, 160))}`,
	);
}

if (failed > 0) {
	process.exit(1);
}
console.log("done");
