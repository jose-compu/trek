import { dirname, join, relative, resolve, sep } from "node:path";
import type { PreImage } from "../edit-checkpoints/checkpoint-manager.ts";
import { generateUnifiedPatch } from "../tools/edit-diff.ts";
import type {
	FileVersionRecord,
	HistoryRow,
	RestoreResult,
	TrekManifest,
	VersionArtifact,
	VersionKind,
} from "./types.ts";
import { TREK_STORE_VERSION } from "./types.ts";

export interface TrekStoreFs {
	read(absPath: string): Promise<string | null>;
	write(absPath: string, content: string): Promise<void>;
	remove(absPath: string): Promise<void>;
	mkdirp(absPath: string): Promise<void>;
}

export interface RecordOptions {
	promptNumber: number;
	promptId: string;
	stepId?: string;
	relPath: string;
	kind: VersionKind;
	before: PreImage;
	after?: string | null;
	toRelPath?: string;
}

const emptyManifest = (): TrekManifest => ({ version: TREK_STORE_VERSION, prompts: {} });

function safeRelPath(cwd: string, absPath: string): string | undefined {
	const rel = relative(resolve(cwd), resolve(absPath));
	if (!rel || rel.startsWith("..") || rel.startsWith(`.trek${sep}`) || rel === ".trek") {
		return undefined;
	}
	return rel.split(sep).join("/");
}

function artifactDir(storeRoot: string, relPath: string): string {
	return join(storeRoot, "versions", ...relPath.split("/"));
}

export class TrekVersionStore {
	private readonly cwd: string;
	private readonly ops: TrekStoreFs;
	private readonly storeRoot: string;

	constructor(cwd: string, ops: TrekStoreFs, storeRoot = join(cwd, ".trek")) {
		this.cwd = cwd;
		this.ops = ops;
		this.storeRoot = storeRoot;
	}

	async loadManifest(): Promise<TrekManifest> {
		const raw = await this.ops.read(join(this.storeRoot, "manifest.json"));
		if (!raw) {
			return emptyManifest();
		}
		try {
			const parsed = JSON.parse(raw) as TrekManifest;
			if (!parsed || parsed.version !== TREK_STORE_VERSION || !parsed.prompts) {
				return emptyManifest();
			}
			return parsed;
		} catch {
			return emptyManifest();
		}
	}

	async saveManifest(manifest: TrekManifest): Promise<void> {
		await this.ops.mkdirp(this.storeRoot);
		await this.ops.write(join(this.storeRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	}

	async record(options: RecordOptions): Promise<FileVersionRecord | undefined> {
		const relPath = options.relPath.split(sep).join("/");
		if (!relPath || relPath.startsWith("..")) {
			return undefined;
		}
		const manifest = await this.loadManifest();
		const promptKey = String(options.promptNumber);
		const entry = manifest.prompts[promptKey] ?? { promptId: options.promptId, files: [] };
		entry.promptId = options.promptId;
		if (options.stepId) {
			entry.stepId = options.stepId;
		}

		const existingForPath = Object.values(manifest.prompts).flatMap((p) => p.files.filter((f) => f.path === relPath));
		const from = existingForPath.length === 0 ? 0 : Math.max(...existingForPath.map((f) => f.to));
		const to = from + 1;
		const ext = options.kind === "edit" ? "json" : "json";
		const dir = artifactDir(this.storeRoot, relPath);
		await this.ops.mkdirp(dir);
		const artifactRel = `versions/${relPath}/v${to}.${ext}`;
		const artifact: VersionArtifact = {
			kind: options.kind,
			path: relPath,
			toPath: options.toRelPath,
			promptNumber: options.promptNumber,
			promptId: options.promptId,
			stepId: options.stepId,
			before: options.before,
			diff:
				options.kind === "edit" && options.before.kind === "content" && typeof options.after === "string"
					? generateUnifiedPatch(relPath, options.before.content, options.after)
					: undefined,
		};
		await this.ops.write(join(this.storeRoot, artifactRel), `${JSON.stringify(artifact, null, 2)}\n`);

		const record: FileVersionRecord = {
			path: relPath,
			from,
			to,
			kind: options.kind,
			artifact: artifactRel,
			toPath: options.toRelPath,
		};
		entry.files.push(record);
		manifest.prompts[promptKey] = entry;
		await this.saveManifest(manifest);
		return record;
	}

	async recordGitRef(promptNumber: number, git: { branch?: string; commit?: string }): Promise<void> {
		const manifest = await this.loadManifest();
		const entry = manifest.prompts[String(promptNumber)];
		if (!entry) {
			return;
		}
		entry.git = { ...entry.git, ...git };
		await this.saveManifest(manifest);
	}

	async list(): Promise<HistoryRow[]> {
		const manifest = await this.loadManifest();
		const rows: HistoryRow[] = [];
		for (const [key, entry] of Object.entries(manifest.prompts)) {
			const promptNumber = Number(key);
			for (const file of entry.files) {
				rows.push({
					promptNumber,
					promptId: entry.promptId,
					stepId: entry.stepId,
					path: file.path,
					kind: file.kind,
					from: file.from,
					to: file.to,
					artifact: file.artifact,
					git: entry.git,
				});
			}
		}
		return rows.sort((a, b) => a.promptNumber - b.promptNumber || a.path.localeCompare(b.path));
	}

	async restoreToPrompt(m: number): Promise<RestoreResult> {
		const manifest = await this.loadManifest();
		const earliest = new Map<string, VersionArtifact>();
		const promptNumbers = Object.keys(manifest.prompts)
			.map(Number)
			.filter((n) => n >= m)
			.sort((a, b) => a - b);

		for (const n of promptNumbers) {
			const entry = manifest.prompts[String(n)];
			if (!entry) continue;
			for (const file of entry.files) {
				if (earliest.has(file.path)) {
					continue;
				}
				const raw = await this.ops.read(join(this.storeRoot, file.artifact));
				if (!raw) continue;
				try {
					earliest.set(file.path, JSON.parse(raw) as VersionArtifact);
				} catch {
					// skip corrupt artifact
				}
			}
		}

		const restored: string[] = [];
		const removed: string[] = [];
		const renamed: string[] = [];
		for (const [relPath, artifact] of earliest) {
			const abs = resolve(this.cwd, relPath);
			if (artifact.kind === "rename" && artifact.toPath) {
				const dest = resolve(this.cwd, artifact.toPath);
				await this.ops.remove(dest);
				renamed.push(artifact.toPath);
			}
			if (artifact.before.kind === "absent") {
				await this.ops.remove(abs);
				removed.push(relPath);
			} else {
				await this.ops.mkdirp(dirname(abs));
				await this.ops.write(abs, artifact.before.content);
				restored.push(relPath);
			}
		}

		for (const n of promptNumbers.reverse()) {
			delete manifest.prompts[String(n)];
		}
		await this.saveManifest(manifest);
		return { restored, removed, renamed };
	}

	async restoreToStep(stepId: string): Promise<RestoreResult> {
		const manifest = await this.loadManifest();
		for (const [key, entry] of Object.entries(manifest.prompts)) {
			if (entry.stepId === stepId || entry.promptId === stepId) {
				return this.restoreToPrompt(Number(key));
			}
		}
		return { restored: [], removed: [], renamed: [] };
	}

	toRelPath(absPath: string): string | undefined {
		return safeRelPath(this.cwd, absPath);
	}
}
