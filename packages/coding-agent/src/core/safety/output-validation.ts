/**
 * Typed tool output validation (issue #8, SPECS_SAFETY_HARNESS §13 item 2).
 *
 * Tool inputs are already validated against their TypeBox schemas by the agent loop.
 * This module validates the OUTPUT shape of a tool result. On mismatch the caller
 * appends a reflection note to the result so the model treats it as unreliable and
 * re-verifies instead of silently consuming malformed data.
 */

export interface OutputValidationIssue {
	/** JSON-path-ish locator of the offending field, e.g. `content[1].text`. */
	path: string;
	message: string;
}

const KNOWN_PART_TYPES = new Set(["text", "image"]);

/** Validate the structural shape of a tool result. Returns an empty array when valid. */
export function validateToolResultShape(result: unknown): OutputValidationIssue[] {
	const issues: OutputValidationIssue[] = [];
	if (result === null || typeof result !== "object") {
		return [{ path: "", message: `expected an object, got ${result === null ? "null" : typeof result}` }];
	}

	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return [{ path: "content", message: `expected an array of content parts, got ${typeof content}` }];
	}

	content.forEach((part, index) => {
		const at = `content[${index}]`;
		if (part === null || typeof part !== "object") {
			issues.push({
				path: at,
				message: `expected a content part object, got ${part === null ? "null" : typeof part}`,
			});
			return;
		}
		const type = (part as { type?: unknown }).type;
		if (typeof type !== "string") {
			issues.push({ path: `${at}.type`, message: "expected a string part type" });
			return;
		}
		if (!KNOWN_PART_TYPES.has(type)) {
			// Unknown part types are tolerated (extensions may add them); only shape is enforced.
			return;
		}
		if (type === "text" && typeof (part as { text?: unknown }).text !== "string") {
			issues.push({ path: `${at}.text`, message: "expected string text on a text part" });
		}
		if (type === "image") {
			if (typeof (part as { data?: unknown }).data !== "string") {
				issues.push({ path: `${at}.data`, message: "expected base64 string data on an image part" });
			}
			if (typeof (part as { mimeType?: unknown }).mimeType !== "string") {
				issues.push({ path: `${at}.mimeType`, message: "expected string mimeType on an image part" });
			}
		}
	});

	return issues;
}

/** Build the reflection note appended to a tool result when its output shape mismatched. */
export function formatSchemaMismatchNote(toolName: string, issues: OutputValidationIssue[]): string {
	const detail = issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join("; ");
	return `[schema-mismatch] Output of tool "${toolName}" failed schema validation (${detail}). Treat this result as unreliable: re-run the tool or verify the state another way before relying on it.`;
}
