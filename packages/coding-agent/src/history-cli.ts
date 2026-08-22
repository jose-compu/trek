import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME } from "./config.ts";
import { nodeTrekStoreFs, TrekVersionStore } from "./core/trek-store/index.ts";

function printHistoryHelp(): void {
	console.log(`${APP_NAME} history`);
	console.log("  List .trek file versions recorded for this project.");
}

function printRevertHelp(): void {
	console.log(`${APP_NAME} revert --prompt N`);
	console.log(`${APP_NAME} revert --step ID`);
	console.log("  Restore files using .trek history (diffs + delete snapshots).");
}

export async function handleHistoryCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "history") {
		return false;
	}
	if (args.includes("--help") || args.includes("-h")) {
		printHistoryHelp();
		return true;
	}
	const cwd = process.cwd();
	if (!existsSync(join(cwd, ".trek", "manifest.json"))) {
		console.error(chalk.red("No .trek/manifest.json in this directory."));
		process.exitCode = 1;
		return true;
	}
	const store = new TrekVersionStore(cwd, nodeTrekStoreFs);
	const rows = await store.list();
	if (rows.length === 0) {
		console.log("No recorded versions.");
		return true;
	}
	for (const row of rows) {
		const git = row.git?.commit ? `  git:${row.git.commit.slice(0, 8)}` : "";
		console.log(
			`#${row.promptNumber} ${row.promptId}  ${row.kind}  ${row.path}  v${row.from}->v${row.to}  step=${row.stepId ?? "-"}${git}`,
		);
	}
	return true;
}

export async function handleRevertCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "revert") {
		return false;
	}
	if (args.includes("--help") || args.includes("-h")) {
		printRevertHelp();
		return true;
	}
	const cwd = process.cwd();
	if (!existsSync(join(cwd, ".trek", "manifest.json"))) {
		console.error(chalk.red("No .trek/manifest.json in this directory."));
		process.exitCode = 1;
		return true;
	}

	let prompt: number | undefined;
	let step: string | undefined;
	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--prompt" && args[i + 1]) {
			prompt = Number(args[++i]);
		} else if (args[i] === "--step" && args[i + 1]) {
			step = args[++i];
		}
	}
	if ((prompt === undefined || Number.isNaN(prompt)) && !step) {
		console.error(chalk.red(`Usage: ${APP_NAME} revert --prompt N | --step ID`));
		process.exitCode = 1;
		return true;
	}

	const store = new TrekVersionStore(cwd, nodeTrekStoreFs);
	const result = step ? await store.restoreToStep(step) : await store.restoreToPrompt(prompt as number);
	console.log(
		`Reverted. restored=${result.restored.join(",") || "-"} removed=${result.removed.join(",") || "-"} renamed=${result.renamed.join(",") || "-"}`,
	);
	return true;
}
