import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "./config.ts";

function printProcessesHelp(): void {
	console.log(`${APP_NAME} processes`);
	console.log("  Print the current prompt's parallel, sequence, guarded choice, and inversion tree.");
}

export async function handleProcessesCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "processes") {
		return false;
	}
	if (args.includes("--help") || args.includes("-h")) {
		printProcessesHelp();
		return true;
	}
	const file = join(process.cwd(), ".trek", "processes.txt");
	if (!existsSync(file)) {
		console.log("No process tree for this prompt.");
		return true;
	}
	const text = readFileSync(file, "utf-8").trim();
	console.log(text.length > 0 ? text : "No process tree for this prompt.");
	return true;
}
