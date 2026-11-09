/**
 * Checked-in Unix recipe packs. Missing optional tools skip. Never download.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { bundledDomainsRoot } from "../domains/catalog.ts";
import { probeUnixTools } from "./unix-tools.ts";

export interface Recipe {
	id: string;
	tool: string;
	template: string;
	mutates: boolean;
	optional: boolean;
	pack: string;
}

interface RecipeFile {
	pack?: string;
	recipes?: Array<{
		id?: unknown;
		tool?: unknown;
		template?: unknown;
		mutates?: unknown;
		optional?: unknown;
	}>;
}

export function recipesDir(bundledRoot = bundledDomainsRoot()): string {
	return join(bundledRoot, "meta", "recipes");
}

export function loadRecipePacks(bundledRoot = bundledDomainsRoot()): Recipe[] {
	let names: string[] = [];
	try {
		names = readdirSync(recipesDir(bundledRoot))
			.filter((name) => name.endsWith(".yaml"))
			.sort();
	} catch {
		return [];
	}
	const recipes: Recipe[] = [];
	for (const name of names) {
		const pack = name.replace(/\.yaml$/, "");
		let parsed: RecipeFile;
		try {
			parsed = parse(readFileSync(join(recipesDir(bundledRoot), name), "utf8")) as RecipeFile;
		} catch {
			continue;
		}
		const packId = typeof parsed.pack === "string" ? parsed.pack : pack;
		for (const row of parsed.recipes ?? []) {
			if (typeof row.id !== "string" || typeof row.tool !== "string" || typeof row.template !== "string") {
				continue;
			}
			recipes.push({
				id: row.id,
				tool: row.tool,
				template: row.template,
				mutates: row.mutates === true,
				optional: row.optional === true,
				pack: packId,
			});
		}
	}
	return recipes;
}

export function recipeIsAvailable(recipe: Recipe, present: ReadonlySet<string>): boolean {
	if (!recipe.optional) {
		return true;
	}
	return present.has(recipe.tool);
}

export function presentUnixTools(): Set<string> {
	const present = new Set<string>(["grep", "find", "git", "awk"]);
	for (const tool of probeUnixTools().tools) {
		if (tool.present) {
			present.add(tool.id);
		}
	}
	return present;
}

export function listRecipes(options: { tool?: string; bundledRoot?: string } = {}): Recipe[] {
	const present = presentUnixTools();
	return loadRecipePacks(options.bundledRoot).filter((recipe) => {
		if (options.tool && recipe.tool !== options.tool && recipe.pack !== options.tool) {
			return false;
		}
		return recipeIsAvailable(recipe, present);
	});
}

export function formatRecipeList(recipes: readonly Recipe[]): string {
	if (recipes.length === 0) {
		return "no recipes (optional tools skipped)";
	}
	return recipes.map((recipe) => `${recipe.pack}/${recipe.id}  ${recipe.tool}  ${recipe.template}`).join("\n");
}

export function bashRecipeSuggestion(task = ""): string {
	const hay = task.toLowerCase();
	const all = loadRecipePacks();
	const present = presentUnixTools();
	const available = all.filter((recipe) => recipeIsAvailable(recipe, present));
	const hit = available.filter((recipe) => hay.includes(recipe.tool) || hay.includes(recipe.pack));
	const shown = hit.length > 0 ? hit : available;
	return shown
		.slice(0, 12)
		.map((recipe) => `${recipe.tool}: ${recipe.template}`)
		.join("; ");
}
