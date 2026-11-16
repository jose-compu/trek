import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchTask } from "./score.ts";

export function benchTasksRoot(): string {
	return fileURLToPath(new URL("../../bench/tasks/", import.meta.url));
}

export function codingAgentRoot(): string {
	return fileURLToPath(new URL("../../", import.meta.url));
}

export function loadBenchTasks(root = benchTasksRoot()): BenchTask[] {
	const ids = readdirSync(root)
		.filter((name) => statSync(join(root, name)).isDirectory())
		.sort();
	return ids.map((id) => {
		const raw = JSON.parse(readFileSync(join(root, id, "task.json"), "utf8")) as BenchTask;
		if (raw.id !== id) {
			throw new Error(`${id}/task.json id is ${raw.id}`);
		}
		return raw;
	});
}
