/**
 * /hierarchy auto fills slots from a provider catalog.
 * Ids come from the catalog only. Heuristic uses tags, thinking, and price — not SKU names.
 * Decision is `kind: decision` (Liquid d1, Qwen 4B) or else the cheapest chat SKU (Grok Fast, Luna, Haiku).
 */

import { readFileSync } from "node:fs";
import { flattenToSingle } from "./registry.ts";
import type { RoleAssignment, RoleSource, RoleThinking, RuntimeConfig, RuntimeRole } from "./types.ts";

export const CATALOG_TAGS = [
	"cheap",
	"default",
	"mid",
	"thinking",
	"coding",
	"reasoning",
	"frontier",
	"multi-agent",
] as const;
export type CatalogTag = (typeof CATALOG_TAGS)[number];

export const CATALOG_KINDS = ["chat", "decision", "embedding"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export interface CatalogModel {
	id: string;
	provider: string;
	tags?: string[];
	thinking?: boolean;
	kind?: CatalogKind;
	source?: RoleSource;
	/** Input USD / 1M tokens. Used only when tags do not decide. */
	inputPrice?: number;
}

export interface CatalogFixture {
	provider: string;
	models: CatalogModel[];
}

export type AutoMappedRole = "decision" | "tooling" | "workhorse" | "planning" | "frontier";

export interface AutoMapResult {
	layering: "single" | "auto";
	roles: Partial<Record<AutoMappedRole, RoleAssignment>>;
}

const MAPPED_EXTRAS = [
	"decision",
	"tooling",
	"planning",
	"frontier",
	"verifier",
] as const satisfies readonly RuntimeRole[];

export function loadCatalogFixture(path: string): CatalogFixture {
	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`invalid catalog ${path}`);
	}
	const record = raw as Record<string, unknown>;
	if (typeof record.provider !== "string" || !Array.isArray(record.models)) {
		throw new Error(`invalid catalog ${path}`);
	}
	const models: CatalogModel[] = [];
	for (const item of record.models) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const row = item as Record<string, unknown>;
		if (typeof row.id !== "string" || row.id.trim().length === 0 || typeof row.provider !== "string") {
			continue;
		}
		const model: CatalogModel = { id: row.id.trim(), provider: row.provider };
		if (Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string")) {
			model.tags = row.tags;
		}
		if (typeof row.thinking === "boolean") {
			model.thinking = row.thinking;
		}
		if (row.kind === "chat" || row.kind === "decision" || row.kind === "embedding") {
			model.kind = row.kind;
		}
		if (row.source === "api" || row.source === "local" || row.source === "lmstudio") {
			model.source = row.source;
		}
		if (typeof row.inputPrice === "number" && Number.isFinite(row.inputPrice)) {
			model.inputPrice = row.inputPrice;
		}
		models.push(model);
	}
	return { provider: record.provider, models };
}

export function mapCatalogToRoles(catalog: CatalogFixture): AutoMapResult {
	const chat = catalog.models.filter((model) => (model.kind ?? "chat") === "chat");
	const dedicatedDecision = catalog.models.find((model) => model.kind === "decision");
	if (chat.length === 0) {
		if (dedicatedDecision) {
			return { layering: "single", roles: { decision: assign(dedicatedDecision, "decision") } };
		}
		return { layering: "single", roles: {} };
	}
	if (chat.length === 1) {
		const roles: AutoMapResult["roles"] = { workhorse: assign(chat[0]!, "workhorse") };
		if (dedicatedDecision && dedicatedDecision.id !== chat[0]!.id) {
			roles.decision = assign(dedicatedDecision, "decision");
		}
		return { layering: "single", roles };
	}

	const taken = new Set<string>();
	const take = (model: CatalogModel | undefined): CatalogModel | undefined => {
		if (!model || taken.has(model.id)) {
			return undefined;
		}
		taken.add(model.id);
		return model;
	};
	const unused = (): CatalogModel[] => chat.filter((model) => !taken.has(model.id));

	const workhorse =
		take(pickTagged(unused(), ["default", "mid"])) ?? take(defaultWorkhorse(unused())) ?? take(unused()[0]);
	const planning = take(pickPlanning(unused())) ?? take(strongestNonCheap(unused()));
	const frontier = take(pickTagged(unused(), ["frontier", "multi-agent"]));
	const tooling = take(pickTagged(unused(), ["cheap"]));

	const roles: AutoMapResult["roles"] = {};
	if (workhorse) {
		roles.workhorse = assign(workhorse, "workhorse");
	}
	if (planning && planning.id !== workhorse?.id) {
		roles.planning = assign(planning, "planning");
	}
	if (frontier && frontier.id !== workhorse?.id && frontier.id !== planning?.id) {
		roles.frontier = assign(frontier, "frontier");
	}
	if (tooling && tooling.id !== workhorse?.id && tooling.id !== planning?.id && tooling.id !== frontier?.id) {
		roles.tooling = assign(tooling, "tooling");
	}
	const decision = dedicatedDecision ?? pickTagged(chat, ["cheap"]) ?? [...chat].sort(byCost)[0];
	if (decision) {
		roles.decision = assign(decision, "decision");
	}
	if (!roles.workhorse) {
		return { layering: "single", roles: {} };
	}
	const extras = Boolean(roles.planning || roles.frontier || roles.tooling);
	return { layering: extras ? "auto" : "single", roles };
}

export function applyAutoLayering(config: RuntimeConfig, catalog: CatalogFixture): RuntimeConfig {
	const mapped = mapCatalogToRoles(catalog);
	if (mapped.layering === "single") {
		const flat = flattenToSingle(config);
		const roles = { ...flat.roles };
		if (mapped.roles.workhorse) {
			roles.workhorse = mapped.roles.workhorse;
		}
		if (mapped.roles.decision) {
			roles.decision = mapped.roles.decision;
		} else {
			delete roles.decision;
		}
		return { ...flat, roles };
	}
	const roles = { ...config.roles };
	for (const extra of MAPPED_EXTRAS) {
		delete roles[extra];
	}
	Object.assign(roles, mapped.roles);
	const hierarchy = { ...config.hierarchy, layering: "auto" as const };
	// Full remap: auto --catalog replaces prior --clear unbinds for mapped slots.
	delete hierarchy.unbound;
	return {
		hierarchy,
		roles,
		...(config.routing ? { routing: config.routing } : {}),
	};
}

function pickTagged(models: CatalogModel[], tags: string[]): CatalogModel | undefined {
	return models.find((model) => tags.some((tag) => hasTag(model, tag)));
}

function pickPlanning(models: CatalogModel[]): CatalogModel | undefined {
	const tagged = pickTagged(models, ["thinking", "coding", "reasoning"]);
	if (tagged) {
		return tagged;
	}
	return models.find((model) => model.thinking && !hasTag(model, "cheap"));
}

function defaultWorkhorse(models: CatalogModel[]): CatalogModel | undefined {
	if (models.length === 0) {
		return undefined;
	}
	const sorted = [...models].sort(byCost);
	if (sorted.length <= 2) {
		return sorted[0];
	}
	return sorted[1];
}

function strongestNonCheap(models: CatalogModel[]): CatalogModel | undefined {
	const candidates = models.filter((model) => !hasTag(model, "cheap"));
	if (candidates.length === 0) {
		return undefined;
	}
	return [...candidates].sort(byCost).at(-1);
}

function byCost(a: CatalogModel, b: CatalogModel): number {
	const left = a.inputPrice ?? 1;
	const right = b.inputPrice ?? 1;
	if (left !== right) {
		return left - right;
	}
	return a.id.localeCompare(b.id);
}

function hasTag(model: CatalogModel, tag: string): boolean {
	return (model.tags ?? []).includes(tag);
}

function assign(model: CatalogModel, role: AutoMappedRole): RoleAssignment {
	const assignment: RoleAssignment = {
		source: model.source ?? "api",
		id: model.id,
		thinking: thinkingFor(model, role),
	};
	if (model.provider) {
		assignment.provider = model.provider;
	}
	return assignment;
}

function thinkingFor(model: CatalogModel, role: AutoMappedRole): RoleThinking {
	if (role === "decision") {
		return "off";
	}
	if (role === "planning" || role === "frontier") {
		return "deep";
	}
	if (role === "workhorse" && (model.thinking || hasTag(model, "thinking") || hasTag(model, "reasoning"))) {
		return "brief";
	}
	if (role === "tooling" && model.thinking) {
		return "brief";
	}
	return "off";
}
