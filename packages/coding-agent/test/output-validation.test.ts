import { describe, expect, test } from "vitest";
import { formatSchemaMismatchNote, validateToolResultShape } from "../src/core/safety/index.ts";

describe("typed tool output validation (#8)", () => {
	test("accepts a well-formed text result", () => {
		expect(validateToolResultShape({ content: [{ type: "text", text: "ok" }] })).toEqual([]);
	});

	test("accepts a well-formed image result", () => {
		expect(validateToolResultShape({ content: [{ type: "image", data: "abc", mimeType: "image/png" }] })).toEqual([]);
	});

	test("flags missing content array", () => {
		const issues = validateToolResultShape({ details: {} });
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toBe("content");
	});

	test("flags a text part missing its text field", () => {
		const issues = validateToolResultShape({ content: [{ type: "text" }] });
		expect(issues[0]?.path).toBe("content[0].text");
	});

	test("tolerates unknown part types (extensions)", () => {
		expect(validateToolResultShape({ content: [{ type: "custom", foo: 1 }] })).toEqual([]);
	});

	test("mismatch note names the tool and reflection guidance", () => {
		const note = formatSchemaMismatchNote("read", [{ path: "content", message: "expected an array" }]);
		expect(note).toMatch(/schema-mismatch/);
		expect(note).toMatch(/read/);
		expect(note).toMatch(/unreliable/i);
	});
});
