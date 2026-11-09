/**
 * 0.19-D: recipe packs. Optional tools skip. Nothing is downloaded.
 * Run: npx vitest --run test/recipes.test.ts --reporter=verbose
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRecipePacks, recipeIsAvailable } from "../src/core/tools/recipe-packs.ts";

const bundled = join(dirname(fileURLToPath(import.meta.url)), "../domains");

describe("recipe packs", () => {
	it("loads rg, jq, and diff/patch packs", () => {
		const recipes = loadRecipePacks(bundled);
		const ids = recipes.map((recipe) => recipe.id);
		expect(ids).toContain("rg-literal");
		expect(ids).toContain("jq-pretty");
		expect(ids).toContain("diff-unified");
		expect(ids).toContain("patch-apply");
		expect(ids).toContain("sg-rename");
		expect(ids).toContain("mlr-cat");
	});

	it("skips optional sg and mlr when absent", () => {
		const recipes = loadRecipePacks(bundled);
		const present = new Set(["rg", "jq", "diff", "patch"]);
		const sg = recipes.find((recipe) => recipe.id === "sg-rename");
		const mlr = recipes.find((recipe) => recipe.id === "mlr-cat");
		const rg = recipes.find((recipe) => recipe.id === "rg-literal");
		expect(sg?.optional).toBe(true);
		expect(mlr?.optional).toBe(true);
		expect(recipeIsAvailable(sg!, present)).toBe(false);
		expect(recipeIsAvailable(mlr!, present)).toBe(false);
		expect(recipeIsAvailable(rg!, present)).toBe(true);
	});
});
