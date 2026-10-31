/**
 * Chat model for a llama-server role. Used when the selected role source is local.
 * The saved API model in settings is left unchanged.
 */

import type { Model } from "@trek/ai";
import { contextBudget, localContextWindow } from "./context-budget.ts";
import { mlxModelDir, useMlx } from "./mlx-backend.ts";
import { resolveWeightPath } from "./process-manager.ts";

export const LOCAL_LLAMA_PROVIDER = "local";

/**
 * Wall clock for one local completion.
 * 4096 tokens at about 90 tok/s fits in a minute. This aborts a stream that keeps emitting.
 */
export const LOCAL_LLAMA_TIMEOUT_MS = 120_000;

export function localLlamaChatModel(input: { modelId: string; endpoint: string }): Model<"openai-completions"> {
	const contextWindow = localContextWindow(input.modelId);
	const budget = contextBudget(contextWindow);
	return {
		// MLX loads the snapshot directory. The GGUF path is not a model there and comes back 404.
		id: useMlx(input.modelId) ? mlxModelDir(input.modelId) : resolveWeightPath(input.modelId),
		name: input.modelId,
		api: "openai-completions",
		provider: LOCAL_LLAMA_PROVIDER,
		baseUrl: input.endpoint,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: budget.small ? budget.outputTokens : Math.min(4096, contextWindow),
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
