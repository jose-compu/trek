import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { BASH_RECIPES, suggestRecipes } from "../src/core/tools/bash-recipes.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bash-recipes");

describe("bash recipes", () => {
	it("suggests a named tool, or the full set when the task names none", () => {
		expect(suggestRecipes("use jq on the pump file").map((recipe) => recipe.tool)).toEqual(["jq"]);
		expect(suggestRecipes("look at the notes")).toEqual(BASH_RECIPES);
	});

	it("lists the six recipes on the bash tool", () => {
		const tool = createBashToolDefinition(fixture);
		for (const recipe of BASH_RECIPES) {
			expect(tool.description).toContain(recipe.command);
		}
	});

	it("runs each recipe in the fixture", () => {
		for (const recipe of BASH_RECIPES) {
			const stdout = execFileSync("bash", ["-lc", recipe.command], {
				cwd: fixture,
				encoding: "utf-8",
			});
			expect(stdout.trim().length).toBeGreaterThan(0);
		}
	});
});
