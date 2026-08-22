import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { TrekStoreFs } from "./store.ts";

export const nodeTrekStoreFs: TrekStoreFs = {
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
		await writeFile(absPath, content);
	},
	async remove(absPath: string): Promise<void> {
		await rm(absPath, { force: true });
	},
	async mkdirp(absPath: string): Promise<void> {
		await mkdir(absPath, { recursive: true });
	},
};
