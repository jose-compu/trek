import { spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyTask } from "../core/runtime/select-role.ts";
import { type BenchLever, type BenchProfile, leverLabel, leverModelsYaml, leverSettingsJson } from "./levers.ts";
import { codingAgentRoot } from "./load.ts";
import { type BenchTask, parseToolTraces, redactSecret, scoreTask, type TaskScore } from "./score.ts";

export interface Scorecard {
	model: string;
	lever: BenchLever;
	mean: number;
	passed: number;
	total: number;
	tasks: TaskScore[];
}

function readKeyFromEnvFile(path: string): string | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("XAI_API_KEY=")) {
			continue;
		}
		return trimmed
			.slice("XAI_API_KEY=".length)
			.trim()
			.replace(/^['"]|['"]$/g, "");
	}
	return undefined;
}

/** Live runs use xAI only. The key is never returned to logs. */
export function resolveXaiKey(cwd: string): string | undefined {
	const fromEnv = process.env.XAI_API_KEY?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	let dir = cwd;
	for (let i = 0; i < 4; i++) {
		const key = readKeyFromEnvFile(join(dir, ".env"));
		if (key) {
			return key;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}

function workspaceFiles(taskDir: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const name of readdirSync(dir)) {
			if (name === "task.json") {
				continue;
			}
			const abs = join(dir, name);
			const rel = prefix ? `${prefix}/${name}` : name;
			if (statSync(abs).isDirectory()) {
				walk(abs, rel);
			} else {
				out.push(rel);
			}
		}
	};
	walk(taskDir, "");
	return out;
}

function runChild(input: {
	cli: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
	args: string[];
	timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, input.args, {
			cwd: input.cwd,
			env: input.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, input.timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
		});
	});
}

export async function runScorecard(input: {
	tasks: Array<{ task: BenchTask; dir: string }>;
	lever: BenchLever;
	profile?: BenchProfile;
	timeoutMs: number;
	apiKey: string;
}): Promise<Scorecard> {
	const profile = input.profile ?? "same";
	const cli = join(codingAgentRoot(), "dist", "cli.js");
	if (!existsSync(cli)) {
		throw new Error(`Missing ${cli}. Build @trek/coding-agent first.`);
	}
	const tasks: TaskScore[] = [];
	for (const entry of input.tasks) {
		const started = Date.now();
		const work = mkdtempSync(join(tmpdir(), "trek-bench-"));
		const agentDir = join(work, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(dirname(agentDir), "models.yaml"), leverModelsYaml(input.lever, profile));
		writeFileSync(join(agentDir, "settings.json"), leverSettingsJson(profile));
		const cwd = join(work, "project");
		mkdirSync(cwd, { recursive: true });
		for (const rel of workspaceFiles(entry.dir)) {
			const from = join(entry.dir, rel);
			const to = join(cwd, rel);
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to);
		}
		if (entry.task.plant) {
			const planted = join(cwd, entry.task.plant.path);
			mkdirSync(dirname(planted), { recursive: true });
			writeFileSync(planted, entry.task.plant.contents);
		}
		const kind = classifyTask(entry.task.prompt).kind;
		console.error(`[bench] ${input.lever} ${entry.task.id} class=${kind}`);
		const result = await runChild({
			cli,
			cwd,
			timeoutMs: input.timeoutMs,
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				TMPDIR: process.env.TMPDIR,
				LANG: process.env.LANG,
				TERM: "dumb",
				XAI_API_KEY: input.apiKey,
				TREK_CODING_AGENT_DIR: agentDir,
			},
			args: [cli, "--no-session", "--print", "--verbose", "--tools", entry.task.tools.join(","), entry.task.prompt],
		});
		const fileText: Record<string, string> = {};
		for (const check of entry.task.files) {
			const path = join(cwd, check.path);
			if (existsSync(path) && statSync(path).isFile()) {
				fileText[check.path] = readFileSync(path, "utf8");
			}
		}
		const dirsPresent: Record<string, boolean> = {};
		for (const dir of entry.task.dirs ?? []) {
			const path = join(cwd, dir);
			dirsPresent[dir] = existsSync(path) && statSync(path).isDirectory();
		}
		const scored = scoreTask(
			entry.task,
			{
				stdout: result.stdout,
				stderr: result.stderr,
				toolCalls: parseToolTraces(result.stderr),
				fileText,
				dirsPresent,
				timedOut: result.timedOut,
				exitCode: result.exitCode,
			},
			kind,
			Date.now() - started,
		);
		const tail = redactSecret(result.stderr.split("\n").slice(-8).join("\n"), entry.task.secret);
		if (!scored.pass) {
			console.error(tail);
		}
		const spawned = result.stderr.includes("spawn_branches");
		console.error(
			`[bench] ${entry.task.id} pass=${scored.pass} score=${scored.score} tools=${scored.toolCount} spawn=${spawned} ${scored.durationMs}ms ${scored.notes.join("; ")}`,
		);
		tasks.push(scored);
		rmSync(work, { recursive: true, force: true });
	}
	const mean = tasks.reduce((sum, task) => sum + task.score, 0) / (tasks.length || 1);
	return {
		model: leverLabel(input.lever, profile),
		lever: input.lever,
		mean,
		passed: tasks.filter((task) => task.pass).length,
		total: tasks.length,
		tasks,
	};
}
