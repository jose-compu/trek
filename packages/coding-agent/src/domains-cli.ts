/**
 * trek domains and trek workflows — 0.12.0.
 */

import { resolve } from "node:path";
import chalk from "chalk";
import { APP_NAME } from "./config.ts";
import { addDomain, disableDomain, enableDomain, loadDomainCatalog } from "./core/domains/catalog.ts";
import { formatLessonPattern, lessonPatternFor } from "./core/domains/lesson-pattern.ts";
import { runPatternCommand } from "./core/domains/pattern-command.ts";
import { runArchonWorkflow } from "./core/domains/run.ts";
import { overrideSelection } from "./core/domains/select.ts";
import { formatDomainList, runDomainSessionCommand } from "./core/domains/session-command.ts";
import { dismissLesson, formatLessonsTable, loadLessonRecord } from "./core/reflective-loop/crystallize.ts";

export async function handleDomainsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "domains") {
		return false;
	}
	const sub = args[1] ?? "list";
	const cwd = process.cwd();
	try {
		if (sub === "list" || sub === "--help" || sub === "-h") {
			if (sub === "--help" || sub === "-h") {
				printDomainsHelp();
				return true;
			}
			printDomains(cwd);
			return true;
		}
		if (sub === "enable") {
			requireId(args[2], "domains enable <id>");
			enableDomain(cwd, args[2]);
			printDomains(cwd);
			return true;
		}
		if (sub === "disable") {
			requireId(args[2], "domains disable <id>");
			disableDomain(cwd, args[2]);
			printDomains(cwd);
			return true;
		}
		if (sub === "lessons") {
			requireId(args[2], "domains lessons <id>");
			const pattern = lessonPatternFor(cwd, args[2]);
			if (!pattern) throw new Error(`no lesson pattern for ${args[2]}`);
			console.log(formatLessonPattern(pattern));
			return true;
		}
		if (sub === "patterns") {
			console.log(runPatternCommand(cwd, args.slice(2).join(" ")));
			return true;
		}
		if (sub === "add") {
			if (!args[2] || !args[3]) {
				throw new Error(`Usage: ${APP_NAME} domains add <id> <file.yaml>`);
			}
			const fileName = addDomain(cwd, args[2], resolve(args[3]));
			console.log(`added ${args[2]} ${fileName} (disabled until enable)`);
			return true;
		}
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
	console.error(chalk.red(`Unknown domains command ${sub}.`));
	printDomainsHelp();
	process.exitCode = 1;
	return true;
}

export async function handleWorkflowsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "workflows") {
		return false;
	}
	const sub = args[1] ?? "list";
	const cwd = process.cwd();
	try {
		if (sub === "list" || sub === "--help" || sub === "-h") {
			if (sub === "--help" || sub === "-h") {
				printWorkflowsHelp();
				return true;
			}
			printDomains(cwd);
			return true;
		}
		if (sub === "show") {
			requireId(args[2], "workflows show <id>");
			const shown = runDomainSessionCommand(cwd, "workflows", `show ${args[2]}`);
			process.stdout.write(shown.endsWith("\n") ? shown : `${shown}\n`);
			return true;
		}
		if (sub === "run") {
			requireId(args[2], "workflows run <id>");
			const catalog = loadDomainCatalog(cwd);
			const selection = overrideSelection(catalog, args[2]);
			const domain = findDomain(cwd, args[2]);
			const results = await runArchonWorkflow(domain.workflow, { cwd });
			console.log(`selection_reason: ${selection.selectionReason}`);
			for (const result of results) {
				console.log(`--- ${result.id} ---`);
				console.log(result.output);
			}
			return true;
		}
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
	console.error(chalk.red(`Unknown workflows command ${sub}.`));
	printWorkflowsHelp();
	process.exitCode = 1;
	return true;
}

function printDomains(cwd: string): void {
	console.log(formatDomainList(cwd));
}

function findDomain(cwd: string, id: string) {
	const catalog = loadDomainCatalog(cwd);
	const domain = catalog.domains.find((item) => item.id === id);
	if (!domain) {
		throw new Error(`unknown domain ${id}`);
	}
	return domain;
}

function requireId(id: string | undefined, usage: string): asserts id is string {
	if (!id) {
		throw new Error(`Usage: ${APP_NAME} ${usage}`);
	}
}

export async function handleLessonsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "lessons") return false;
	const sub = args[1] ?? "list";
	const cwd = process.cwd();
	try {
		if (sub === "--help" || sub === "-h") {
			printLessonsHelp();
			return true;
		}
		if (sub === "list") {
			console.log(formatLessonsTable(cwd, args[2]));
			return true;
		}
		if (sub === "show") {
			requireId(args[2], "lessons show <id>");
			const lesson = loadLessonRecord(cwd, args[2]);
			if (!lesson) throw new Error(`unknown lesson ${args[2]}`);
			console.log(JSON.stringify(lesson, null, "\t"));
			return true;
		}
		if (sub === "dismiss") {
			requireId(args[2], "lessons dismiss <id>");
			console.log(dismissLesson(cwd, args[2]));
			return true;
		}
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
	console.error(chalk.red(`Unknown lessons command ${sub}.`));
	printLessonsHelp();
	process.exitCode = 1;
	return true;
}

function printLessonsHelp(): void {
	console.log(`${APP_NAME} lessons list [domain]`);
	console.log(`${APP_NAME} lessons show <id>`);
	console.log(`${APP_NAME} lessons dismiss <id>`);
}

export async function handlePatternsCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "patterns") return false;
	const cwd = process.cwd();
	try {
		console.log(runPatternCommand(cwd, args.slice(1).join(" ")));
		return true;
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
}

function printDomainsHelp(): void {
	console.log(`${APP_NAME} domains list`);
	console.log(`${APP_NAME} domains enable <id>`);
	console.log(`${APP_NAME} domains disable <id>`);
	console.log(`${APP_NAME} domains lessons <id>`);
	console.log(`${APP_NAME} domains patterns`);
	console.log(`${APP_NAME} domains add <id> <file.yaml>`);
	console.log("  Meta, AI, Security, and Engineering stay on.");
	console.log("  A domain added later starts disabled.");
	console.log("  patterns edits .trek/domains/<id>/lessons.yaml and leaves the bundled file alone.");
}

function printWorkflowsHelp(): void {
	console.log(`${APP_NAME} workflows list`);
	console.log(`${APP_NAME} workflows show <id>`);
	console.log(`${APP_NAME} workflows run <id>`);
	console.log("  run calls bash nodes. A prompt node is an AI step and is called in the session, one step per node.");
}
