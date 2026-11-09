/**
 * Short bash recipes for file tools. Packs live under domains/meta/recipes/.
 */

import { listRecipes, bashRecipeSuggestion as packSuggestion, type Recipe } from "./recipe-packs.ts";

export { listRecipes, loadRecipePacks, type Recipe } from "./recipe-packs.ts";

export const BASH_RECIPE_TOOLS = ["grep", "sed", "awk", "rg", "find", "jq"] as const;

export type BashRecipeTool = (typeof BASH_RECIPE_TOOLS)[number];

export interface BashRecipe {
	id: string;
	tool: BashRecipeTool;
	command: string;
}

/** Static fixture recipes. Packs are the 0.19 source of truth for `/recipes`. */
export const BASH_RECIPES: readonly BashRecipe[] = [
	{ id: "grep-log", tool: "grep", command: "grep cistern notes/log.txt" },
	{ id: "sed-line", tool: "sed", command: "sed -n '1p' notes/log.txt" },
	{ id: "awk-field", tool: "awk", command: "awk '{print $1}' notes/log.txt" },
	{ id: "rg-log", tool: "rg", command: "rg cistern notes/log.txt" },
	{ id: "find-nested", tool: "find", command: "find . -name spare.txt" },
	{ id: "jq-key", tool: "jq", command: "jq -r .pump data/pump.json" },
];

export function suggestRecipes(task: string): readonly Recipe[] {
	const hay = task.toLowerCase();
	const all = listRecipes();
	const hit = all.filter((recipe) => hay.includes(recipe.tool) || hay.includes(recipe.pack));
	return hit.length > 0 ? hit : all;
}

export function bashRecipeSuggestion(task = ""): string {
	const fromPacks = packSuggestion(task);
	if (fromPacks.length > 0) {
		return fromPacks;
	}
	const hay = task.toLowerCase();
	const hit = BASH_RECIPES.filter((recipe) => hay.includes(recipe.tool));
	const shown = hit.length > 0 ? hit : BASH_RECIPES;
	return shown.map((recipe) => `${recipe.tool}: ${recipe.command}`).join("; ");
}
