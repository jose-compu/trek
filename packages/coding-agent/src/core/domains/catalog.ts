/**
 * Bundled domains plus domains added under .trek/domains/.
 * Enablement is a disabled-id list. Added domains start disabled.
 * Meta, AI, Security, and Engineering cannot be disabled.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPackageDir } from "../../config.ts";
import { type ArchonWorkflow, loadArchonFile, parseArchonWorkflow } from "./archon.ts";
import { warmLessonPatterns } from "./lesson-pattern.ts";

export interface WorkflowEntry {
	file: string;
	terms: string[];
	name: string;
	description: string;
	yaml: string;
	nodeIds: string[];
	workflow: ArchonWorkflow;
}

export interface DomainDefinition {
	id: string;
	title: string;
	alwaysOn: boolean;
	terms: string[];
	added: boolean;
	workflowName: string;
	description: string;
	yaml: string;
	nodeIds: string[];
	workflow: ArchonWorkflow;
	workflows?: WorkflowEntry[];
}

export interface DomainCatalog {
	domains: DomainDefinition[];
	disabled: Set<string>;
}

interface DomainManifest {
	id: string;
	title: string;
	alwaysOn?: boolean;
	terms: string[];
	workflow?: string;
	workflows?: Array<{ file: string; terms: string[] }>;
}

interface DomainState {
	disabled: string[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

export function bundledDomainsRoot(): string {
	return join(getPackageDir(), "domains");
}

const LAYER_FILE = /^layer-[a-z0-9-]+\.yaml$/;

const layerWorkflowCache = new Map<string, ArchonWorkflow[]>();

/** Bundled 0.18 layering DAGs under domains/meta/. Not extra domains. */
export function loadLayerWorkflows(bundledRoot = bundledDomainsRoot()): ArchonWorkflow[] {
	const hit = layerWorkflowCache.get(bundledRoot);
	if (hit) {
		return hit;
	}
	const dir = join(bundledRoot, "meta");
	let names: string[] = [];
	try {
		names = readdirSync(dir)
			.filter((name) => LAYER_FILE.test(name))
			.sort();
	} catch {
		return [];
	}
	const workflows = names.map((name) => loadArchonFile(join(dir, name)));
	layerWorkflowCache.set(bundledRoot, workflows);
	return workflows;
}

export function findLayerWorkflow(name: string, bundledRoot = bundledDomainsRoot()): ArchonWorkflow | undefined {
	return loadLayerWorkflows(bundledRoot).find((workflow) => workflow.name === name);
}

export function loadDomainCatalog(cwd: string, bundledRoot = bundledDomainsRoot()): DomainCatalog {
	warmLessonPatterns(cwd, bundledRoot);
	const state = readState(cwd);
	const disabled = new Set(state.disabled);
	const bundled = readBundledDomainDir(bundledRoot);
	const added = readAddedDomains(cwd);
	const local = new Map(added.map((domain) => [domain.id, domain]));
	const domains = bundled.map((domain) => {
		const overlay = local.get(domain.id);
		if (!overlay) return domain;
		return { ...overlay, alwaysOn: domain.alwaysOn, terms: overlay.terms.length > 0 ? overlay.terms : domain.terms };
	});
	for (const domain of added) {
		if (!bundled.some((item) => item.id === domain.id)) domains.push(domain);
	}
	return { domains, disabled };
}

export function enabledDomains(catalog: DomainCatalog): DomainDefinition[] {
	return catalog.domains.filter((domain) => domain.alwaysOn || !catalog.disabled.has(domain.id));
}

export function disableDomain(cwd: string, id: string): void {
	const catalog = loadDomainCatalog(cwd);
	const domain = requireDomain(catalog, id);
	if (domain.alwaysOn) {
		throw new Error(`${domain.title} cannot be disabled`);
	}
	const state = readState(cwd);
	if (!state.disabled.includes(id)) {
		state.disabled.push(id);
		state.disabled.sort();
		writeState(cwd, state);
	}
}

export function enableDomain(cwd: string, id: string): void {
	const catalog = loadDomainCatalog(cwd);
	requireDomain(catalog, id);
	const state = readState(cwd);
	state.disabled = state.disabled.filter((item) => item !== id);
	writeState(cwd, state);
}

export function addDomain(cwd: string, id: string, workflowFile: string): string {
	if (!ID_PATTERN.test(id)) {
		throw new Error("domain id must be lowercase letters, numbers, and hyphens");
	}
	const bundled = readDomainDir(bundledDomainsRoot(), false);
	if (bundled.some((domain) => domain.id === id)) {
		throw new Error(`${id} is already an initial domain`);
	}
	const yaml = readFileSync(workflowFile, "utf8");
	const workflow = parseArchonWorkflow(yaml, workflowFile);
	const dir = join(cwd, ".trek", "domains", id);
	mkdirSync(dir, { recursive: true });
	const fileName = `${workflow.name}.yaml`;
	writeFileSync(join(dir, fileName), yaml.endsWith("\n") ? yaml : `${yaml}\n`);
	const manifest: DomainManifest = {
		id,
		title: titleFromId(id),
		alwaysOn: false,
		terms: termsFromWorkflow(workflow),
		workflow: fileName,
	};
	writeFileSync(join(dir, "domain.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	const state = readState(cwd);
	if (!state.disabled.includes(id)) {
		state.disabled.push(id);
		state.disabled.sort();
	}
	writeState(cwd, state);
	return fileName;
}

/** Append a workflow YAML to an existing domain under `.trek/domains/<id>/`. */
export function addWorkflowToDomain(
	cwd: string,
	domainId: string,
	yamlText: string,
	terms: string[] = [],
): { name: string; file: string } {
	if (!ID_PATTERN.test(domainId)) {
		throw new Error("domain id must be lowercase letters, numbers, and hyphens");
	}
	const current = loadDomainCatalog(cwd).domains.find((domain) => domain.id === domainId);
	if (!current) {
		throw new Error(`unknown domain ${domainId}`);
	}
	const workflow = parseArchonWorkflow(yamlText);
	if (!ID_PATTERN.test(workflow.name)) {
		throw new Error("workflow name must be lowercase letters, numbers, and hyphens");
	}
	for (const node of workflow.nodes) {
		if (node.kind !== "prompt" && node.kind !== "bash") {
			throw new Error(`node ${node.id} must be a prompt or bash step`);
		}
	}
	const text = ensureNewline(yamlText);
	const dir = join(cwd, ".trek", "domains", domainId);
	const manifest = ensureDomainOverlayManifest(cwd, current);
	const fileName = `${workflow.name}.yaml`;
	const entries = listManifestWorkflows(manifest);
	if (entries.some((entry) => entry.file === fileName || entry.file === `${workflow.name}.yaml`)) {
		throw new Error(`workflow ${workflow.name} already exists on ${domainId}`);
	}
	if (current.workflows?.some((entry) => entry.name === workflow.name)) {
		throw new Error(`workflow ${workflow.name} already exists on ${domainId}`);
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, fileName), text);
	entries.push({
		file: fileName,
		terms: terms.length > 0 ? terms.map((term) => term.toLowerCase()) : termsFromWorkflow(workflow),
	});
	const next: DomainManifest = {
		id: current.id,
		title: current.title,
		alwaysOn: current.alwaysOn,
		terms: current.terms,
		workflows: entries,
	};
	writeFileSync(join(dir, "domain.json"), `${JSON.stringify(next, null, "\t")}\n`);
	return { name: workflow.name, file: fileName };
}

function ensureDomainOverlayManifest(cwd: string, current: DomainDefinition): DomainManifest {
	const dir = join(cwd, ".trek", "domains", current.id);
	mkdirSync(dir, { recursive: true });
	const manifestPath = join(dir, "domain.json");
	if (existsSync(manifestPath)) {
		return JSON.parse(readFileSync(manifestPath, "utf8")) as DomainManifest;
	}
	const bundledManifestPath = join(bundledDomainsRoot(), current.id, "domain.json");
	if (existsSync(bundledManifestPath)) {
		const bundled = JSON.parse(readFileSync(bundledManifestPath, "utf8")) as DomainManifest;
		for (const entry of listManifestWorkflows(bundled)) {
			const src = join(bundledDomainsRoot(), current.id, entry.file);
			const dest = join(dir, entry.file);
			if (existsSync(src) && !existsSync(dest)) {
				writeFileSync(dest, readFileSync(src));
			}
		}
		const lessonsSrc = join(bundledDomainsRoot(), current.id, "lessons.yaml");
		const lessonsDest = join(dir, "lessons.yaml");
		if (existsSync(lessonsSrc) && !existsSync(lessonsDest)) {
			writeFileSync(lessonsDest, readFileSync(lessonsSrc));
		}
		writeFileSync(manifestPath, `${JSON.stringify(bundled, null, "\t")}\n`);
		return bundled;
	}
	const fileName = `${current.workflowName}.yaml`;
	if (!existsSync(join(dir, fileName))) {
		writeFileSync(join(dir, fileName), ensureNewline(current.yaml));
	}
	const manifest: DomainManifest = {
		id: current.id,
		title: current.title,
		alwaysOn: current.alwaysOn,
		terms: current.terms,
		workflows: [{ file: fileName, terms: current.terms }],
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	return manifest;
}

function listManifestWorkflows(manifest: DomainManifest): Array<{ file: string; terms: string[] }> {
	if (Array.isArray(manifest.workflows) && manifest.workflows.length > 0) {
		return manifest.workflows.map((entry) => ({
			file: entry.file,
			terms: Array.isArray(entry.terms) ? entry.terms.map((term) => String(term).toLowerCase()) : [],
		}));
	}
	if (typeof manifest.workflow === "string") {
		return [{ file: manifest.workflow, terms: [] }];
	}
	return [];
}

export interface SavedWorkflow {
	name: string;
	created: boolean;
	backedUp: boolean;
}

/** Write a workflow under `.trek/domains/<id>/`. A previous file is kept in `history/`. */
export function saveDomainWorkflow(cwd: string, id: string, yamlText: string): SavedWorkflow {
	if (!ID_PATTERN.test(id)) {
		throw new Error("domain id must be lowercase letters, numbers, and hyphens");
	}
	const workflow = parseArchonWorkflow(yamlText);
	if (!ID_PATTERN.test(workflow.name)) {
		throw new Error("workflow name must be lowercase letters, numbers, and hyphens");
	}
	for (const node of workflow.nodes) {
		if (node.kind !== "prompt" && node.kind !== "bash") {
			throw new Error(`node ${node.id} must be a prompt or bash step`);
		}
	}
	const text = yamlText.endsWith("\n") ? yamlText : `${yamlText}\n`;
	const current = loadDomainCatalog(cwd).domains.find((domain) => domain.id === id);
	if (current && current.yaml.trim() === text.trim()) {
		return { name: workflow.name, created: false, backedUp: false };
	}
	const dir = join(cwd, ".trek", "domains", id);
	const history = join(dir, "history");
	mkdirSync(history, { recursive: true });
	const index = readHistory(history) ?? { order: [], at: 0 };
	if (current && index.order.length === 0) {
		const seed = writeHistoryFile(history, current.workflowName, ensureNewline(current.yaml));
		index.order = [seed];
		index.at = 0;
	}
	const kept = index.order.length === 0 ? 0 : index.at + 1;
	for (const name of index.order.slice(kept)) {
		const path = join(history, name);
		if (existsSync(path)) unlinkSync(path);
	}
	index.order = index.order.slice(0, kept);
	index.order.push(writeHistoryFile(history, workflow.name, text));
	index.at = index.order.length - 1;
	const fileName = `${workflow.name}.yaml`;
	const previousFile = readManifestWorkflow(join(dir, "domain.json"));
	writeFileSync(join(dir, fileName), text);
	if (previousFile && previousFile !== fileName && existsSync(join(dir, previousFile))) {
		unlinkSync(join(dir, previousFile));
	}
	const manifest: DomainManifest = {
		id,
		title: current?.title ?? titleFromId(id),
		alwaysOn: current?.alwaysOn ?? false,
		terms: current && current.terms.length > 0 ? current.terms : termsFromWorkflow(workflow),
		workflow: fileName,
	};
	writeFileSync(join(dir, "domain.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	writeHistory(history, index);
	if (!current) {
		const state = readState(cwd);
		if (!state.disabled.includes(id)) {
			state.disabled.push(id);
			state.disabled.sort();
			writeState(cwd, state);
		}
	}
	return { name: workflow.name, created: !current, backedUp: Boolean(current) };
}

/** Go back one saved version. The package copy of a bundled workflow is never overwritten. */
export function restoreDomainWorkflow(cwd: string, id: string): { name: string } {
	const catalog = loadDomainCatalog(cwd);
	const current = catalog.domains.find((domain) => domain.id === id);
	if (!current) {
		throw new Error(`unknown domain ${id}`);
	}
	const dir = join(cwd, ".trek", "domains", id);
	const history = join(dir, "history");
	const index = readHistory(history);
	if (!index || index.at <= 0) {
		throw new Error(`no previous ${id} workflow`);
	}
	index.at -= 1;
	const yaml = readFileSync(join(history, index.order[index.at] ?? ""), "utf8");
	const workflow = parseArchonWorkflow(yaml);
	const fileName = `${workflow.name}.yaml`;
	const previousFile = readManifestWorkflow(join(dir, "domain.json"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, fileName), ensureNewline(yaml));
	if (previousFile && previousFile !== fileName && existsSync(join(dir, previousFile))) {
		unlinkSync(join(dir, previousFile));
	}
	const manifest: DomainManifest = {
		id,
		title: current.title,
		alwaysOn: current.alwaysOn,
		terms: current.terms,
		workflow: fileName,
	};
	writeFileSync(join(dir, "domain.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	writeHistory(history, index);
	return { name: workflow.name };
}

interface HistoryIndex {
	order: string[];
	at: number;
}

function readManifestWorkflow(path: string): string | undefined {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DomainManifest>;
		return typeof raw.workflow === "string" ? raw.workflow : undefined;
	} catch {
		return undefined;
	}
}

function readHistory(dir: string): HistoryIndex | undefined {
	try {
		const raw = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Partial<HistoryIndex>;
		if (!raw || !Array.isArray(raw.order) || typeof raw.at !== "number") return undefined;
		const order = raw.order.filter((item) => typeof item === "string");
		if (raw.at < 0 || raw.at >= order.length) return undefined;
		return { order, at: raw.at };
	} catch {
		return undefined;
	}
}

function writeHistory(dir: string, index: HistoryIndex): void {
	writeFileSync(join(dir, "index.json"), `${JSON.stringify(index, null, "\t")}\n`);
}

function writeHistoryFile(dir: string, name: string, text: string): string {
	const stamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
	let file = `${stamp}-${name}.yaml`;
	let n = 1;
	while (existsSync(join(dir, file))) {
		n += 1;
		file = `${stamp}-${name}-${n}.yaml`;
	}
	writeFileSync(join(dir, file), text);
	return file;
}

function ensureNewline(text: string): string {
	return text.endsWith("\n") ? text : `${text}\n`;
}

function requireDomain(catalog: DomainCatalog, id: string): DomainDefinition {
	const domain = catalog.domains.find((item) => item.id === id);
	if (!domain) {
		throw new Error(`unknown domain ${id}`);
	}
	return domain;
}

const bundledDomainDirCache = new Map<string, DomainDefinition[]>();

function readBundledDomainDir(root: string): DomainDefinition[] {
	const hit = bundledDomainDirCache.get(root);
	if (hit) return hit;
	const domains = readDomainDir(root, false);
	bundledDomainDirCache.set(root, domains);
	return domains;
}

function readAddedDomains(cwd: string): DomainDefinition[] {
	const root = join(cwd, ".trek", "domains");
	return readDomainDir(root, true);
}

function readDomainDir(root: string, added: boolean): DomainDefinition[] {
	let names: string[] = [];
	try {
		names = readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
	const domains: DomainDefinition[] = [];
	for (const name of names.sort()) {
		const manifestPath = join(root, name, "domain.json");
		let manifest: DomainManifest;
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DomainManifest;
		} catch {
			continue;
		}
		if (!manifest || manifest.id !== name || !Array.isArray(manifest.terms)) {
			continue;
		}
		if (typeof manifest.workflow !== "string" && !Array.isArray(manifest.workflows)) {
			continue;
		}
		const hasMultiple = Array.isArray(manifest.workflows) && manifest.workflows.length > 0;
		const primaryFile = hasMultiple && manifest.workflows ? manifest.workflows[0].file : manifest.workflow;
		if (typeof primaryFile !== "string") {
			continue;
		}
		const workflowPath = join(root, name, primaryFile);
		const yaml = readFileSync(workflowPath, "utf8");
		const workflow = parseArchonWorkflow(yaml, workflowPath);
		const workflowEntries: WorkflowEntry[] | undefined =
			hasMultiple && manifest.workflows
				? manifest.workflows.map((entry) => {
						const entryPath = join(root, name, entry.file);
						const entryYaml = readFileSync(entryPath, "utf8");
						const entryWorkflow = parseArchonWorkflow(entryYaml, entryPath);
						return {
							file: entry.file,
							terms: entry.terms.map((term) => term.toLowerCase()),
							name: entryWorkflow.name,
							description: entryWorkflow.description,
							yaml: entryYaml,
							nodeIds: entryWorkflow.nodes.map((node) => node.id),
							workflow: entryWorkflow,
						};
					})
				: undefined;
		domains.push({
			id: manifest.id,
			title:
				typeof manifest.title === "string" && manifest.title.length > 0 ? manifest.title : titleFromId(manifest.id),
			alwaysOn: manifest.alwaysOn === true,
			terms: manifest.terms.map((term) => term.toLowerCase()),
			added,
			workflowName: workflow.name,
			description: workflow.description,
			yaml,
			nodeIds: workflow.nodes.map((node) => node.id),
			workflow,
			workflows: workflowEntries,
		});
	}
	return domains;
}

function readState(cwd: string): DomainState {
	try {
		const raw = JSON.parse(readFileSync(statePath(cwd), "utf8")) as Partial<DomainState>;
		const disabled = Array.isArray(raw.disabled) ? raw.disabled.filter((id) => typeof id === "string") : [];
		return { disabled };
	} catch {
		return { disabled: [] };
	}
}

function writeState(cwd: string, state: DomainState): void {
	const path = statePath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ disabled: state.disabled }, null, "\t")}\n`);
}

function statePath(cwd: string): string {
	return join(cwd, ".trek", "domains", "state.json");
}

function titleFromId(id: string): string {
	return id
		.split("-")
		.map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
		.join(" ");
}

function termsFromWorkflow(workflow: ArchonWorkflow): string[] {
	const words = `${workflow.name} ${workflow.description}`
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length >= 5);
	return [...new Set(words)].slice(0, 12);
}
