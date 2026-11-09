import { APP_NAME } from "./config.ts";
import { formatRecipeList, listRecipes } from "./core/tools/recipe-packs.ts";

export async function handleRecipesCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "recipes") {
		return false;
	}
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`${APP_NAME} recipes [--tool X]`);
		console.log("  List checked-in Unix recipes. Optional tools skip when missing.");
		return true;
	}
	let tool: string | undefined;
	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--tool" && args[i + 1]) {
			tool = args[++i];
		}
	}
	console.log(formatRecipeList(listRecipes({ tool })));
	return true;
}
