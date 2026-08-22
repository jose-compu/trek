import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitRef {
	branch?: string;
	commit?: string;
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, { cwd, encoding: "utf-8" });
		return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
	} catch (error) {
		const err = error as { stdout?: string; stderr?: string; code?: number };
		return { stdout: (err.stdout ?? "").trim(), stderr: (err.stderr ?? "").trim(), code: err.code ?? 1 };
	}
}

export async function isGitRepo(cwd: string): Promise<boolean> {
	const result = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	return result.code === 0 && result.stdout === "true";
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
	const result = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return result.code === 0 && result.stdout ? result.stdout : undefined;
}

/** Hint only — never creates a branch unless `create` is true. */
export async function suggestTaskBranch(cwd: string, slug: string, create = false): Promise<string> {
	const name = `trek/${slug.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "task"}`;
	if (create && (await isGitRepo(cwd))) {
		await git(cwd, ["checkout", "-B", name]);
	}
	return name;
}

/**
 * Stage listed relative paths and create a small labeled commit.
 * Never stash, force-push, rebase, or reset --hard.
 */
export async function commitPromptFiles(
	cwd: string,
	relPaths: string[],
	promptNumber: number,
): Promise<GitRef | undefined> {
	if (relPaths.length === 0 || !(await isGitRepo(cwd))) {
		return undefined;
	}
	const add = await git(cwd, ["add", "--", ...relPaths]);
	if (add.code !== 0) {
		return undefined;
	}
	const commit = await git(cwd, ["commit", "-m", `trek: prompt #${promptNumber}`, "--", ...relPaths]);
	if (commit.code !== 0) {
		return { branch: await currentBranch(cwd) };
	}
	const sha = await git(cwd, ["rev-parse", "HEAD"]);
	return {
		branch: await currentBranch(cwd),
		commit: sha.code === 0 ? sha.stdout : undefined,
	};
}
