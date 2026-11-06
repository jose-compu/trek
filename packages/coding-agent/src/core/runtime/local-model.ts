/**
 * Chat model for a llama-server role. Used when the selected role source is local.
 * The saved API model in settings is left unchanged.
 */

import type { Model } from "@trek/ai";
import { DEFAULT_LMSTUDIO_BASE_URL } from "./types.ts";

export const LOCAL_LLAMA_PROVIDER = "local";
export const LMSTUDIO_PROVIDER = "lmstudio";

/**
 * Wall clock for one local completion.
 * 4096 tokens at about 90 tok/s fits in a minute. This aborts a stream that keeps emitting.
 */
export const LOCAL_LLAMA_TIMEOUT_MS = 120_000;

/** One or more models already loaded in LM Studio. No llama.cpp process. */
export function lmStudioChatModel(input: { modelId: string; endpoint?: string }): Model<"openai-completions"> {
	const endpoint = input.endpoint?.trim() || DEFAULT_LMSTUDIO_BASE_URL;
	return {
		id: input.modelId,
		name: input.modelId,
		api: "openai-completions",
		provider: LMSTUDIO_PROVIDER,
		baseUrl: endpoint,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 4096,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
		},
	};
}
