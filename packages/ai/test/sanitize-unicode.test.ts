import { describe, expect, it } from "vitest";
import { sanitizeJsonValue, sanitizeProviderText, sanitizeSurrogates } from "../src/utils/sanitize-unicode.ts";

describe("sanitizeProviderText", () => {
	it("keeps valid emoji and strips NUL plus unpaired surrogates", () => {
		const unpaired = String.fromCharCode(0xd83d);
		expect(sanitizeProviderText(`Hello 🙈\u0000 ${unpaired} world`)).toBe("Hello 🙈  world");
		expect(sanitizeSurrogates("Hello 🙈")).toBe("Hello 🙈");
	});

	it("sanitizes nested tool-call argument strings", () => {
		const unpaired = String.fromCharCode(0xd83d);
		expect(
			sanitizeJsonValue({
				path: "src/facade.ts",
				edits: [{ oldText: `a\u0000`, newText: `b${unpaired}` }],
			}),
		).toEqual({
			path: "src/facade.ts",
			edits: [{ oldText: "a", newText: "b" }],
		});
	});
});
