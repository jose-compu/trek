import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_MODEL_ID, type BenchLever, type BenchProfile } from "./bench/levers.ts";
import { benchTasksRoot, loadBenchTasks } from "./bench/load.ts";
import { resolveXaiKey, runScorecard, type Scorecard } from "./bench/run.ts";

function printCard(card: Scorecard): void {
	console.log(
		`lever ${card.lever} model ${card.model} mean ${card.mean.toFixed(2)} passed ${card.passed}/${card.total}`,
	);
	for (const task of card.tasks) {
		const flags = `success=${task.success} honesty=${task.honesty} safety=${task.safety} budget=${task.withinBudget}`;
		console.log(`  ${task.id} class=${task.kind} ${flags} tools=${task.toolCount} ${task.durationMs}ms`);
	}
}

function compare(cards: Scorecard[]): void {
	if (cards.length < 2) {
		return;
	}
	const [left, right] = cards;
	if (!left || !right) {
		return;
	}
	const delta = right.mean - left.mean;
	console.log(`delta ${right.lever} - ${left.lever} = ${delta.toFixed(2)}`);
	if (delta > 0) {
		console.log(`${right.lever} beat ${left.lever} (${left.model} -> ${right.model}).`);
		return;
	}
	console.log(`${right.lever} did not beat ${left.lever} (${left.model} vs ${right.model}).`);
}

export async function handleBenchCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "bench") {
		return false;
	}
	const rest = args.slice(1);
	if (rest.length === 0 || rest.includes("--help") || rest.includes("-h")) {
		console.log(`trek bench run [--live] [--lever single|auto|both] [--profile same|climb|fan] [--task id] [--timeout ms] [--out file]

Scores isolated tool tasks. Not \`trek models benchmark\` (tokens/s).
--profile same uses ${BENCH_MODEL_ID} on every role.
--profile climb uses grok-4.20-0309-non-reasoning alone versus that floor plus grok-4.7 on Planning and Frontier.
--profile fan uses grok-4.7 alone versus grok-4.7 planning and parallel grok-4.20-0309-non-reasoning branches.
Without --live, prints the pack and exits. CI scoring stays in the unit tests.`);
		return true;
	}
	if (rest[0] !== "run") {
		console.error("Usage: trek bench run [--live]");
		return true;
	}
	const leverFlag = rest.includes("--lever") ? rest[rest.indexOf("--lever") + 1] : "both";
	const taskFlag = rest.includes("--task") ? rest[rest.indexOf("--task") + 1] : undefined;
	const timeoutFlag = rest.includes("--timeout") ? Number(rest[rest.indexOf("--timeout") + 1]) : 120_000;
	const outFlag = rest.includes("--out") ? rest[rest.indexOf("--out") + 1] : undefined;
	const profileFlag = rest.includes("--profile") ? rest[rest.indexOf("--profile") + 1] : "same";
	const profile: BenchProfile = profileFlag === "climb" || profileFlag === "fan" ? profileFlag : "same";
	const live = rest.includes("--live");
	let tasks = loadBenchTasks().map((task) => ({ task, dir: join(benchTasksRoot(), task.id) }));
	if (taskFlag) {
		tasks = tasks.filter((entry) => entry.task.id === taskFlag);
	}
	if (!live) {
		for (const entry of tasks) {
			console.log(`${entry.task.id} tools=${entry.task.tools.join(",")} budget=${entry.task.maxTools}`);
		}
		console.log("Offline pack listed. Re-run with --live to call xAI. Scorer tests do not use the network.");
		return true;
	}
	const apiKey = resolveXaiKey(process.cwd());
	if (!apiKey) {
		console.error("XAI_API_KEY is not set and no .env in the working directory provided one.");
		process.exitCode = 1;
		return true;
	}
	const levers: BenchLever[] = leverFlag === "both" ? ["single", "auto"] : [leverFlag as BenchLever];
	const cards: Scorecard[] = [];
	for (const lever of levers) {
		cards.push(await runScorecard({ tasks, lever, profile, timeoutMs: timeoutFlag, apiKey }));
	}
	for (const card of cards) {
		printCard(card);
	}
	compare(cards);
	if (outFlag) {
		writeFileSync(outFlag, `${JSON.stringify(cards, null, 2)}\n`);
		console.log(`wrote ${outFlag}`);
	}
	if (cards.some((card) => card.tasks.some((task) => !task.safety || !task.honesty))) {
		process.exitCode = 1;
	}
	return true;
}
