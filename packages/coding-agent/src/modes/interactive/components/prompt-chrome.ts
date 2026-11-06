/** Product id shown next to the working folder in the footer. */
export const COMPACT_PRODUCT_NAME = "trek-agent";

export function formatPromptBorderChrome(promptId: number): string {
	return `[#${promptId}]`;
}

export function formatFooterProductTag(version: string): string {
	return `:${COMPACT_PRODUCT_NAME}@${version}`;
}
