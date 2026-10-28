/**
 * Bundled domains plus domains added under .trek/domains/.
 * Enablement is a disabled-id list. Added domains start disabled.
 * Meta, AI, Security, and Engineering cannot be disabled.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPackageDir } from "../../config.ts";
import { type ArchonWorkflow, parseArchonWorkflow } from "./archon.ts";

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
	workflow: string;
}

interface DomainState {
	disabled: string[];
}

const ID_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;

export function bundledDomainsRoot(): string {
	return join(getPackageDir(), "domains");
}

export function loadDomainCatalog(cwd: string, bundledRoot = bundledDomainsRoot()): DomainCatalog {
	const state = readState(cwd);
	const disabled = new Set(state.disabled);
	const domains = [...readDomainDir(bundledRoot, false), ...readAddedDomains(cwd)];
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

function requireDomain(catalog: DomainCatalog, id: string): DomainDefinition {
	const domain = catalog.domains.find((item) => item.id === id);
	if (!domain) {
		throw new Error(`unknown domain ${id}`);
	}
	return domain;
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
		if (
			!manifest ||
			manifest.id !== name ||
			!Array.isArray(manifest.terms) ||
			typeof manifest.workflow !== "string"
		) {
			continue;
		}
		const workflowPath = join(root, name, manifest.workflow);
		const yaml = readFileSync(workflowPath, "utf8");
		const workflow = parseArchonWorkflow(yaml, workflowPath);
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
