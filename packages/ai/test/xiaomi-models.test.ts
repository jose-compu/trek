import { describe, expect, it } from "vitest";
import { getModel, getModels } from "../src/models.ts";

describe("Xiaomi MiMo models", () => {
	it("lists mimo-v2.6-flash on the API billing provider", () => {
		expect(getModel("xiaomi", "mimo-v2.6-flash")).toBeDefined();
	});

	it.each(["xiaomi-token-plan-cn", "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp"] as const)(
		"includes mimo-v2.6-flash on %s",
		(provider) => {
			expect(getModels(provider).some((model) => model.id === "mimo-v2.6-flash")).toBe(true);
		},
	);
});
