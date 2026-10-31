/**
 * Short bash recipes for file tools. No model call, no network, no deletion.
 */

export const BASH_RECIPE_TOOLS = ["grep", "sed", "awk", "rg", "find", "jq"] as const;

export type BashRecipeTool = (typeof BASH_RECIPE_TOOLS)[number];

export interface BashRecipe {
	id: string;
	tool: BashRecipeTool;
	command: string;
}

export const BASH_RECIPES: readonly BashRecipe[] = [
	{ id: "grep-log", tool: "grep", command: "grep cistern notes/log.txt" },
	{ id: "sed-line", tool: "sed", command: "sed -n '1p' notes/log.txt" },
	{ id: "awk-field", tool: "awk", command: "awk '{print $1}' notes/log.txt" },
	{ id: "rg-log", tool: "rg", command: "rg cistern notes/log.txt" },
	{ id: "find-nested", tool: "find", command: "find . -name spare.txt" },
	{ id: "jq-key", tool: "jq", command: "jq -r .pump data/pump.json" },
];

export function suggestRecipes(task: string): readonly BashRecipe[] {
	const hay = task.toLowerCase();
	const hit = BASH_RECIPES.filter((recipe) => hay.includes(recipe.tool));
	return hit.length > 0 ? hit : BASH_RECIPES;
}

export function bashRecipeSuggestion(task = ""): string {
	return suggestRecipes(task)
		.map((recipe) => `${recipe.tool}: ${recipe.command}`)
		.join("; ");
}
