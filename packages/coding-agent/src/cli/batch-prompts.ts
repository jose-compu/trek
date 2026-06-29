/**
 * Load prompts for batch mode from a file or stdin.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

/** One non-empty line = one prompt. */
export function parseBatchPromptContent(content: string): string[] {
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

async function readStdinLines(): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const lines: string[] = [];
		const rl = createInterface({ input: process.stdin });
		rl.on("line", (line) => {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				lines.push(trimmed);
			}
		});
		rl.on("close", () => resolve(lines));
		rl.on("error", reject);
	});
}

/** Load batch prompts from a file path, "-" for stdin, or stdin when path is omitted. */
export async function loadBatchPrompts(path: string | true): Promise<string[]> {
	if (path === true || path === "-") {
		if (process.stdin.isTTY) {
			throw new Error("Batch mode requires a prompt file or piped stdin");
		}
		return readStdinLines();
	}

	const content = await readFile(path, "utf8");
	const prompts = parseBatchPromptContent(content);
	if (prompts.length === 0) {
		throw new Error(`Batch file contains no prompts: ${path}`);
	}
	return prompts;
}

/** Validate that a batch file exists and is readable (for early CLI errors). */
export async function assertBatchFileReadable(path: string): Promise<void> {
	if (path === "-") return;
	const stream = createReadStream(path);
	await new Promise<void>((resolve, reject) => {
		stream.once("open", () => {
			stream.close();
			resolve();
		});
		stream.once("error", reject);
	});
}
