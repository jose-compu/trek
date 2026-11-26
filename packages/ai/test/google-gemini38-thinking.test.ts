import { describe, expect, it } from "vitest";
import { getModel, getSupportedThinkingLevels } from "../src/models.ts";
import {
	isGeminiFlashWithoutMinimalModelId,
	resolveGoogleDisabledThinkingLevel,
	resolveGoogleThinkingLevel,
} from "../src/providers/google-shared.ts";

describe("Gemini 3.8 flash thinking levels", () => {
	it("detects flash models that reject MINIMAL", () => {
		expect(isGeminiFlashWithoutMinimalModelId("gemini-3.8-flash")).toBe(true);
		expect(isGeminiFlashWithoutMinimalModelId("gemini-3.7-flash")).toBe(true);
		expect(isGeminiFlashWithoutMinimalModelId("gemini-4-argon")).toBe(false);
		expect(isGeminiFlashWithoutMinimalModelId("gemini-3-flash-preview")).toBe(false);
	});

	it("maps Trek effort to LOW/MEDIUM/HIGH without MINIMAL", () => {
		const model = getModel("google", "gemini-3.8-flash");
		expect(resolveGoogleThinkingLevel(model, "minimal")).toBe("LOW");
		expect(resolveGoogleThinkingLevel(model, "low")).toBe("LOW");
		expect(resolveGoogleThinkingLevel(model, "medium")).toBe("MEDIUM");
		expect(resolveGoogleThinkingLevel(model, "high")).toBe("HIGH");
		expect(resolveGoogleDisabledThinkingLevel(model)).toBe("LOW");
	});

	it("still uses MINIMAL for Gemini 3 flash preview", () => {
		const model = getModel("google", "gemini-3-flash-preview");
		expect(resolveGoogleThinkingLevel(model, "minimal")).toBe("MINIMAL");
		expect(resolveGoogleDisabledThinkingLevel(model)).toBe("MINIMAL");
	});
});

describe("Gemini 3.8 catalog thinking UI levels", () => {
	it("omits minimal when the map marks it unsupported", () => {
		const model = getModel("google", "gemini-3.8-flash");
		const levels = getSupportedThinkingLevels(model);
		expect(levels).not.toContain("minimal");
		expect(levels).toContain("low");
		expect(levels).toContain("medium");
		expect(levels).toContain("high");
	});
});