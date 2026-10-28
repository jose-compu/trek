/**
 * Three LogosDB roots. A row in one root is not visible from another.
 * Native logosdb 1.1.0 stores the vector and one text column.
 * Annotations are the 1.3.0 situating header on the embedded string.
 */

import { existsSync, mkdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { AgentMessage } from "@trek/agent-core";
import { loadManifest, manifestPath, saveManifest } from "logosdb-mcp-server/dist/file-index-manifest.js";
import { hybridRerank } from "logosdb-mcp-server/dist/hybrid.js";
import { NamespaceStore } from "logosdb-mcp-server/dist/store.js";
import { memoryIsActive, type MemorySettings } from "../settings-manager.ts";
import { annotateHandoff, annotateLesson, annotateThinking, annotateTurn, kindOf, type MemoryKind } from "./annotate.ts";
import type { Embedder } from "./embedder.ts";
import {
	chunksForFile,
	coversPath,
	filesAt,
	isIndexableProject,
	listProjectFiles,
	loadIndexPaths,
	pathIsExcluded,
	resolveProjectPath,
	saveIndexPaths,
	type IndexPathLists,
} from "./index-files.ts";
import type { Reranker } from "./rerank.ts";
import { captureTurn, handoffNote } from "./turns.ts";

export type MemoryLayer = "session" | "project" | "global";

export interface MemoryHit {
	id: string;
	layer: MemoryLayer;
	kind: MemoryKind | "note";
	score: number;
	text: string;
}

export interface MemoryInjection {
	text: string;
	lessonIds: string[];
}

export interface MemoryManagerOptions {
	cwd: string;
	sessionId: string;
	sessionDir?: string;
	getSettings: () => Required<MemorySettings>;
	embedder: Embedder;
	globalRoot?: string;
	debounceMs?: number;
	reranker?: Reranker;
}

const NS = "main";

interface OpenDb {
	store: NamespaceStore;
	db: ReturnType<NamespaceStore["open"]>;
}

export class MemoryManager {
	private readonly dbs = new Map<MemoryLayer, OpenDb>();
	private watcher?: FSWatcher;
	private timers = new Map<string, NodeJS.Timeout>();
	private tail: Promise<void> = Promise.resolve();
	private indexing = false;
	private closed = false;
	readonly debounceMs: number;
	private readonly options: MemoryManagerOptions;

	constructor(options: MemoryManagerOptions) {
		this.options = options;
		this.debounceMs = options.debounceMs ?? 500;
	}

	status(): string {
		if (!this.live()) return "memory=off";
		const settings = this.options.getSettings();
		const flag = (on: boolean) => (on ? "on" : "off");
		const chunks = (["session", "project", "global"] as const).map((layer) => `${layer}=${this.chunkCount(layer)}`).join(" ");
		const lists = loadIndexPaths(this.options.cwd);
		const extra = [
			lists.include.length > 0 ? `include: ${lists.include.join(", ")}` : "",
			lists.exclude.length > 0 ? `exclude: ${lists.exclude.join(", ")}` : "",
		].filter(Boolean);
		const line = `session=${flag(settings.session)} project=${flag(settings.project)} global=${flag(settings.global)} topK=${settings.topK} ${this.indexing ? "indexing" : "idle"} chunks ${chunks}`;
		return extra.length > 0 ? `${line}\n${extra.join("\n")}` : line;
	}

	async start(): Promise<void> {
		if (!this.live() || !this.projectEnabled() || !isIndexableProject(this.options.cwd)) return;
		await this.indexProject();
		this.watch();
	}

	async remember(text: string, tag?: string): Promise<string> {
		if (!this.live()) return "memory is off";
		const body = text.trim();
		if (!body) return "nothing to store";
		if (!this.options.getSettings().project) return "project memory is off";
		const row = annotateLesson(body, tag?.trim() || undefined);
		const id = await this.put("project", row.embed, row.stored);
		if (id == null) return "store failed";
		return `stored project:${id}`;
	}

	async recall(query: string, layer?: MemoryLayer, hybrid = true): Promise<MemoryHit[]> {
		if (!this.live()) return [];
		const q = query.trim();
		if (!q) return [];
		const vector = await this.embed(q);
		if (vector.length === 0) return [];
		const settings = this.options.getSettings();
		const layers = (layer ? [layer] : (["session", "project", "global"] as const)).filter((name) => settings[name]);
		const topK = settings.topK;
		const hits: MemoryHit[] = [];
		for (const name of layers) {
			const db = this.open(name);
			if (!db) continue;
			let found: ReturnType<typeof db.search>;
			try {
				found = db.search(vector, Math.max(topK * 8, topK));
			} catch {
				continue;
			}
			const usable = found.filter((hit) => hit.text);
			// Weighted fusion, not RRF. The library's RRF constant ties a two-row swap, so a lexical hit would never pass a nearer vector.
			const ranked = hybrid
				? hybridRerank(usable, q, topK, { fusion: "weighted", lexical_weight: 0.5 })
				: usable.slice(0, topK);
			for (const hit of ranked) {
				const text = hit.text ?? "";
				hits.push({
					id: `${name}:${hit.id}`,
					layer: name,
					kind: kindOf(text),
					score: "hybrid_score" in hit ? (hit as { hybrid_score: number }).hybrid_score : hit.score,
					text,
				});
			}
		}
		hits.sort((a, b) => b.score - a.score);
		if (this.options.reranker && hits.length > 1) {
			const order = await this.options.reranker.rerank(
				q,
				hits.map((hit) => hit.text),
			);
			const next: MemoryHit[] = [];
			for (const index of order) {
				const hit = hits[index];
				if (hit) next.push(hit);
			}
			if (next.length === hits.length) return next.slice(0, topK);
		}
		return hits.slice(0, topK);
	}

	async forget(query: string, layer: MemoryLayer): Promise<string> {
		if (!this.live()) return "memory is off";
		if (!this.options.getSettings()[layer]) return `${layer} memory is off`;
		const hits = await this.recall(query, layer, true);
		const hit = hits[0];
		if (!hit) return "no match";
		const id = Number(hit.id.slice(layer.length + 1));
		const db = this.open(layer);
		if (!db || !Number.isInteger(id)) return "no match";
		try {
			db.delete(id);
		} catch {
			return "delete failed";
		}
		return `deleted ${hit.id}`;
	}

	async buildInjection(query: string): Promise<MemoryInjection> {
		if (!this.live()) return { text: "", lessonIds: [] };
		const q = query.trim().slice(0, 512);
		if (!q) return { text: "", lessonIds: [] };
		let hits: MemoryHit[] = [];
		try {
			hits = await this.recall(q);
		} catch {
			return { text: "", lessonIds: [] };
		}
		const picked = selectInjection(hits, this.options.getSettings().topK);
		if (picked.length === 0) return { text: "", lessonIds: [] };
		const lines = picked.map((hit) => `[${hit.layer} ${hit.kind}] ${hit.text.slice(0, 400)}`);
		return {
			text: `<memory>\n${lines.join("\n")}\n</memory>`,
			lessonIds: picked.filter((hit) => hit.kind === "lesson").map((hit) => hit.id),
		};
	}

	async recordTurn(messages: readonly AgentMessage[], cwd: string): Promise<void> {
		if (!this.live() || !this.options.getSettings().session) return;
		const captured = captureTurn(messages, cwd);
		if (captured.turn) {
			const row = annotateTurn(captured.turn);
			await this.put("session", row.embed, row.stored);
		}
		if (captured.thinking) {
			const row = annotateThinking(captured.thinking.excerpt, captured.thinking.question);
			await this.put("session", row.embed, row.stored);
		}
	}

	async recordHandoff(cwd: string): Promise<void> {
		if (!this.live() || !this.options.getSettings().session) return;
		const row = annotateHandoff(handoffNote(cwd));
		await this.put("session", row.embed, row.stored);
	}

	async indexProject(): Promise<void> {
		if (!this.live() || !this.projectEnabled() || !isIndexableProject(this.options.cwd)) return;
		await this.enqueue(async () => {
			const lists = loadIndexPaths(this.options.cwd);
			for (const file of listProjectFiles(this.options.cwd)) {
				await this.indexOne(file, false);
			}
			for (const extra of lists.include) {
				const resolved = resolveProjectPath(this.options.cwd, extra);
				if ("error" in resolved) continue;
				for (const file of filesAt(this.options.cwd, resolved.abs)) {
					await this.indexOne(file, false);
				}
			}
			await this.deleteCovered(lists);
		});
	}

	async indexFile(absPath: string): Promise<void> {
		if (!this.live() || !this.projectEnabled()) return;
		await this.enqueue(() => this.indexOne(absPath, true));
	}

	/** Index a file or folder and keep it across later reindexes. */
	async addIndexedPath(input: string): Promise<string> {
		if (!this.live()) return "memory is off";
		if (!this.projectEnabled()) return "project memory is off";
		const resolved = resolveProjectPath(this.options.cwd, input);
		if ("error" in resolved) return resolved.error;
		if (!existsSync(resolved.abs)) return "no such path";
		const files = filesAt(this.options.cwd, resolved.abs);
		if (files.length === 0) return "nothing to index";
		const lists = loadIndexPaths(this.options.cwd);
		lists.exclude = lists.exclude.filter((path) => path !== resolved.rel && !coversPath(resolved.rel, path));
		if (!lists.include.includes(resolved.rel)) lists.include.push(resolved.rel);
		saveIndexPaths(this.options.cwd, lists);
		await this.enqueue(async () => {
			for (const file of files) await this.indexOne(file, true);
		});
		return `indexed ${files.length} ${resolved.rel}`;
	}

	/** Drop a file or folder from the index and keep it out. */
	async removeIndexedPath(input: string): Promise<string> {
		if (!this.live()) return "memory is off";
		if (!this.projectEnabled()) return "project memory is off";
		const resolved = resolveProjectPath(this.options.cwd, input);
		if ("error" in resolved) return resolved.error;
		const lists = loadIndexPaths(this.options.cwd);
		lists.include = lists.include.filter((path) => path !== resolved.rel && !coversPath(resolved.rel, path));
		if (!lists.exclude.includes(resolved.rel)) lists.exclude.push(resolved.rel);
		saveIndexPaths(this.options.cwd, lists);
		const removed = await this.enqueue(() => this.deleteCovered(loadIndexPaths(this.options.cwd)));
		return `removed ${resolved.rel} chunks=${removed}`;
	}

	close(): void {
		this.closed = true;
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.watcher?.close();
		this.watcher = undefined;
		for (const open of this.dbs.values()) {
			try {
				open.store.closeAll();
			} catch {
				// already closed
			}
		}
		this.dbs.clear();
	}

	private projectEnabled(): boolean {
		return this.options.getSettings().project;
	}

	private live(): boolean {
		return memoryIsActive(this.options.getSettings());
	}

	private watch(): void {
		if (this.watcher || this.closed) return;
		try {
			this.watcher = watch(this.options.cwd, { recursive: true }, (_event, name) => {
				if (!name || this.closed) return;
				const rel = String(name);
				const parts = rel.split(/[/\\]/);
				if (parts.some((part) => part === ".trek" || part === "node_modules" || part === ".git" || part === "dist")) {
					return;
				}
				const abs = join(this.options.cwd, rel);
				const pending = this.timers.get(abs);
				if (pending) clearTimeout(pending);
				const timer = setTimeout(() => {
					this.timers.delete(abs);
					void this.indexFile(abs).catch(() => undefined);
				}, this.debounceMs);
				timer.unref?.();
				this.timers.set(abs, timer);
			});
			this.watcher.unref?.();
		} catch {
			this.watcher = undefined;
		}
	}

	private async indexOne(absPath: string, force: boolean): Promise<void> {
		if (!existsSync(absPath)) return;
		const db = this.open("project");
		if (!db) return;
		const manifestFile = manifestPath(this.layerRoot("project"), NS);
		const manifest = loadManifest(manifestFile);
		const key = relative(this.options.cwd, absPath).split(sep).join("/");
		if (pathIsExcluded(key, loadIndexPaths(this.options.cwd))) return;
		const prev = manifest.files[key];
		let size = 0;
		let mtimeMs = 0;
		try {
			const st = statSync(absPath);
			if (!st.isFile()) return;
			size = st.size;
			mtimeMs = st.mtimeMs;
		} catch {
			return;
		}
		if (
			!force &&
			prev &&
			prev.size === size &&
			prev.mtimeMs === mtimeMs &&
			prev.chunkMode === "auto" &&
			prev.chunkContext === "header"
		) {
			return;
		}
		if (prev) {
			for (const id of prev.ids) {
				try {
					db.delete(id);
				} catch {
					// row already gone
				}
			}
		}
		const chunks = chunksForFile(absPath, this.options.cwd);
		const ids: number[] = [];
		for (const part of chunks) {
			const id = await this.put("project", part.embed, part.stored);
			if (id != null) ids.push(id);
		}
		manifest.files[key] = {
			mtimeMs,
			size,
			chunkSize: 800,
			chunkMode: "auto",
			chunkContext: "header",
			ids,
		};
		saveManifest(manifestFile, manifest);
	}

	private async put(layer: MemoryLayer, embed: string, stored: string): Promise<number | undefined> {
		const db = this.open(layer);
		if (!db) return undefined;
		const vector = await this.embed(embed);
		if (vector.length !== this.options.embedder.dim) return undefined;
		try {
			return db.put(vector, stored, new Date().toISOString());
		} catch {
			return undefined;
		}
	}

	private async embed(text: string): Promise<number[]> {
		try {
			const vector = await this.options.embedder.embed(text);
			if (vector.length !== this.options.embedder.dim) return [];
			return vector;
		} catch {
			return [];
		}
	}

	/** Live rows on disk. A missing store is zero and is not created. */
	private chunkCount(layer: MemoryLayer): number {
		const existing = this.dbs.get(layer);
		if (existing) {
			try {
				return existing.db.countLive();
			} catch {
				return 0;
			}
		}
		const root = this.layerRoot(layer);
		if (!existsSync(root)) return 0;
		try {
			const store = new NamespaceStore(root);
			const db = store.open(NS, this.options.embedder.dim);
			const count = db.countLive();
			if (this.options.getSettings()[layer] && !this.closed) {
				this.dbs.set(layer, { store, db });
			} else {
				store.closeAll();
			}
			return count;
		} catch {
			return 0;
		}
	}

	private open(layer: MemoryLayer): OpenDb["db"] | undefined {
		if (this.closed || !this.options.getSettings()[layer]) return undefined;
		const existing = this.dbs.get(layer);
		if (existing) return existing.db;
		const root = this.layerRoot(layer);
		try {
			mkdirSync(root, { recursive: true });
			const store = new NamespaceStore(root);
			const db = store.open(NS, this.options.embedder.dim);
			this.dbs.set(layer, { store, db });
			return db;
		} catch {
			return undefined;
		}
	}

	private layerRoot(layer: MemoryLayer): string {
		if (layer === "project") return join(this.options.cwd, ".trek", "memory");
		if (layer === "global") return this.options.globalRoot ?? join(homedir(), ".trek", "memory");
		const base = this.options.sessionDir ? this.options.sessionDir : join(this.options.cwd, ".trek", "sessions");
		return join(base, "memory", this.options.sessionId);
	}

	private async deleteCovered(lists: IndexPathLists): Promise<number> {
		const db = this.open("project");
		if (!db) return 0;
		const manifestFile = manifestPath(this.layerRoot("project"), NS);
		const manifest = loadManifest(manifestFile);
		let removed = 0;
		for (const key of Object.keys(manifest.files)) {
			const rel = key.split(sep).join("/");
			if (!pathIsExcluded(rel, lists)) continue;
			const prev = manifest.files[key];
			if (!prev) continue;
			for (const id of prev.ids) {
				try {
					db.delete(id);
				} catch {
					// row already gone
				}
				removed += 1;
			}
			delete manifest.files[key];
		}
		saveManifest(manifestFile, manifest);
		return removed;
	}

	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.tail.then(async () => {
			this.indexing = true;
			try {
				return await fn();
			} finally {
				this.indexing = false;
			}
		});
		this.tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}

export function selectInjection(hits: readonly MemoryHit[], topK: number): MemoryHit[] {
	const thinking = hits.filter((hit) => hit.kind === "thinking");
	const rest = hits.filter((hit) => hit.kind !== "thinking");
	const picked = rest.slice(0, topK);
	const best = thinking[0];
	if (!best) return picked;
	if (picked.length === 0) return [best];
	const weakest = picked[picked.length - 1];
	if (!weakest || best.score < weakest.score) return picked;
	if (picked.length >= topK) {
		picked[picked.length - 1] = best;
		return picked;
	}
	picked.push(best);
	return picked;
}
