import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CheckpointFsOps } from "./checkpoint-manager.ts";

/** Real filesystem implementation of {@link CheckpointFsOps}. */
export const nodeCheckpointFsOps: CheckpointFsOps = {
	async read(absPath: string): Promise<string | null> {
		try {
			return await readFile(absPath, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	},
	async write(absPath: string, content: string): Promise<void> {
		await mkdir(dirname(absPath), { recursive: true });
		await writeFile(absPath, content);
	},
	async remove(absPath: string): Promise<void> {
		await rm(absPath, { force: true });
	},
};
