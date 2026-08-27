import chalk from "chalk";
import { APP_NAME } from "./config.ts";
import { SessionManager } from "./core/session-manager.ts";
import {
	diffIntentionOutcome,
	findCycleTrace,
	forkLeafId,
	listCycleSummaries,
	locateCycleTraces,
} from "./core/trace/query.ts";
import { replayCounterfactual } from "./core/trace/replay.ts";

function printTraceHelp(): void {
	console.log(`${APP_NAME} trace list`);
	console.log(`${APP_NAME} trace show <cycleId>`);
	console.log(`${APP_NAME} trace diff <cycleId>`);
	console.log(`${APP_NAME} trace fork <cycleId>`);
	console.log(`${APP_NAME} trace replay <cycleId> --observe <text>`);
	console.log("  Inspect O→I→A→R cycle traces in session JSONL.");
	console.log("  Options: --session <path>  --session-dir <dir>  --observe <text>");
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index >= 0 && args[index + 1]) {
		return args[index + 1];
	}
	return undefined;
}

function positionals(args: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--session" || arg === "--session-dir" || arg === "--observe") {
			i++;
			continue;
		}
		if (arg.startsWith("-")) {
			continue;
		}
		out.push(arg);
	}
	return out;
}

function openSession(args: string[]): SessionManager {
	const sessionPath = flagValue(args, "--session");
	if (sessionPath) {
		return SessionManager.open(sessionPath);
	}
	const sessionDir = flagValue(args, "--session-dir");
	const cwd = process.cwd();
	if (sessionDir) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}
	return SessionManager.continueRecent(cwd);
}

function formatLaws(allowed: boolean | undefined): string {
	if (allowed === true) {
		return "allowed";
	}
	if (allowed === false) {
		return "blocked";
	}
	return "-";
}

function printSessionLine(path: string, id: string, name?: string): void {
	const manager = SessionManager.open(path);
	const cycles = listCycleSummaries(manager.getEntries());
	const ids = cycles.map((cycle) => cycle.cycleId).join(",") || "-";
	const label = name ? `  ${name}` : "";
	console.log(`${id.slice(0, 8)}  cycles=${cycles.length}  ${ids}${label}  ${path}`);
}

async function runList(args: string[]): Promise<void> {
	const sessionPath = flagValue(args, "--session");
	if (sessionPath) {
		const manager = SessionManager.open(sessionPath);
		printSessionLine(sessionPath, manager.getSessionId(), manager.getSessionName());
		return;
	}
	const sessionDir = flagValue(args, "--session-dir");
	const sessions = sessionDir ? await SessionManager.listAll(sessionDir) : await SessionManager.list(process.cwd());
	if (sessions.length === 0) {
		console.log("No sessions found.");
		return;
	}
	for (const session of sessions) {
		printSessionLine(session.path, session.id, session.name);
	}
}

function resolveManager(args: string[]): SessionManager | undefined {
	const manager = openSession(args);
	if (!manager.getSessionFile() && locateCycleTraces(manager.getEntries()).length === 0) {
		console.error(chalk.red("No session file found."));
		process.exitCode = 1;
		return undefined;
	}
	return manager;
}

function runShow(args: string[], selector: string | undefined): void {
	if (!selector) {
		console.error(chalk.red(`Usage: ${APP_NAME} trace show <cycleId>`));
		process.exitCode = 1;
		return;
	}
	const manager = resolveManager(args);
	if (!manager) {
		return;
	}
	const located = findCycleTrace(manager.getEntries(), selector);
	if (!located) {
		console.error(chalk.red(`Cycle not found: ${selector}`));
		process.exitCode = 1;
		return;
	}
	const { trace } = located;
	console.log(`${trace.cycleId}  prompt=${trace.promptId ?? "-"}  tools=${trace.toolNames.join(",") || "-"}`);
	console.log(`  observe: ${trace.phases.observe.summary}`);
	console.log(`  intend:  ${trace.phases.intend.summary}`);
	console.log(`  act:     ${trace.phases.act.summary}`);
	console.log(`  reflect: ${trace.phases.reflect.summary}`);
	console.log(
		`  laws:    pre=${formatLaws(trace.lawsVerdict.pre?.allowed)} post=${formatLaws(trace.lawsVerdict.post?.allowed)}`,
	);
}

function runDiff(args: string[], selector: string | undefined): void {
	if (!selector) {
		console.error(chalk.red(`Usage: ${APP_NAME} trace diff <cycleId>`));
		process.exitCode = 1;
		return;
	}
	const manager = resolveManager(args);
	if (!manager) {
		return;
	}
	const located = findCycleTrace(manager.getEntries(), selector);
	if (!located) {
		console.error(chalk.red(`Cycle not found: ${selector}`));
		process.exitCode = 1;
		return;
	}
	const diff = diffIntentionOutcome(located.trace);
	console.log(`${located.trace.cycleId}  status=${diff.status}`);
	console.log(`  intention: ${diff.intend}`);
	console.log(`  outcome:   ${diff.act}`);
	if (diff.tools.length > 0) {
		console.log(`  tools:     ${diff.tools.join(",")}`);
	}
}

function runFork(args: string[], selector: string | undefined): void {
	if (!selector) {
		console.error(chalk.red(`Usage: ${APP_NAME} trace fork <cycleId>`));
		process.exitCode = 1;
		return;
	}
	const manager = resolveManager(args);
	if (!manager) {
		return;
	}
	const located = findCycleTrace(manager.getEntries(), selector);
	if (!located) {
		console.error(chalk.red(`Cycle not found: ${selector}`));
		process.exitCode = 1;
		return;
	}
	const sourcePath = manager.getSessionFile();
	const forkedPath = manager.createBranchedSession(forkLeafId(manager.getEntries(), located));
	if (!forkedPath) {
		console.error(chalk.red("Fork requires a persisted session with an assistant turn."));
		process.exitCode = 1;
		return;
	}
	const nextPrompt = manager.getNextPromptNumber();
	console.log(`forked ${located.trace.cycleId} -> ${forkedPath}`);
	if (sourcePath) {
		console.log(`  parent: ${sourcePath}`);
	}
	console.log(`  nextPrompt: #${nextPrompt}`);
}

function runReplay(args: string[], selector: string | undefined): void {
	if (!selector) {
		console.error(chalk.red(`Usage: ${APP_NAME} trace replay <cycleId> --observe <text>`));
		process.exitCode = 1;
		return;
	}
	const observe = flagValue(args, "--observe");
	if (!observe) {
		console.error(chalk.red(`Usage: ${APP_NAME} trace replay <cycleId> --observe <text>`));
		process.exitCode = 1;
		return;
	}
	const manager = resolveManager(args);
	if (!manager) {
		return;
	}
	try {
		const result = replayCounterfactual(manager, selector, observe);
		console.log(`replay ${result.cycleId} -> ${result.path}`);
		console.log(`  observe: ${observe}`);
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
		process.exitCode = 1;
	}
}

export async function handleTraceCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "trace") {
		return false;
	}
	if (args.includes("--help") || args.includes("-h") || args[1] === "help") {
		printTraceHelp();
		return true;
	}
	const rest = args.slice(1);
	const [subcommand, selector] = positionals(rest);
	if (subcommand === "list" || subcommand === undefined) {
		await runList(rest);
		return true;
	}
	if (subcommand === "show") {
		runShow(rest, selector);
		return true;
	}
	if (subcommand === "diff") {
		runDiff(rest, selector);
		return true;
	}
	if (subcommand === "fork") {
		runFork(rest, selector);
		return true;
	}
	if (subcommand === "replay") {
		runReplay(rest, selector);
		return true;
	}
	console.error(chalk.red(`Unknown trace command: ${subcommand}`));
	printTraceHelp();
	process.exitCode = 1;
	return true;
}
