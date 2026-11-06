/**
 * Chat model for a llama-server role. Used when the selected role source is local.
 * Kept off the API-only import graph (local-model.ts constants).
 */

import type { Model } from "@trek/ai";
import { contextBudget, localContextWindow } from "./context-budget.ts";
import { LOCAL_LLAMA_PROVIDER } from "./local-model.ts";
import { mlxModelDir, useMlx } from "./mlx-backend.ts";
import { resolveWeightPath } from "./process-manager.ts";

export function localLlamaChatModel(input: { modelId: string; endpoint: string }): Model<"openai-completions"> {
	const contextWindow = localContextWindow(input.modelId);
	const budget = contextBudget(contextWindow);
	return {
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
