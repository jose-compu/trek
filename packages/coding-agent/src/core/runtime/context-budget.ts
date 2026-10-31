/**
 * Fit compaction and the reply to the model window.
 * A 2048-token local server cannot carry the full Trek prompt.
 */

export const SMALL_CONTEXT_WINDOW = 4096;

/** Light LFM chat roles. 2048 cannot hold a tool turn. 8192 leaves room for the reply. */
export const LFM_CONTEXT_WINDOWS: Record<string, number> = {
	"LFM2.5-350M": 8192,
	"LFM2.5-1.2B-Instruct": 8192,
	"LFM2.5-8B-A1B": 8192,
};

export function localContextWindow(modelId: string, env: NodeJS.ProcessEnv = process.env): number {
	const raw = Number(env.TREK_LLAMA_CTX);
	const fromEnv = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
	const floor = LFM_CONTEXT_WINDOWS[modelId] ?? 0;
	if (floor > 0) {
		return Math.max(floor, fromEnv);
	}
	return fromEnv > 0 ? fromEnv : 2048;
}

export const SMALL_CONTEXT_TOOLS = ["read", "write", "edit", "bash"] as const;

export interface ContextBudget {
	contextWindow: number;
	small: boolean;
	outputTokens: number;
	reserveTokens: number;
	keepRecentTokens: number;
}

export interface CompactionFitSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export function contextBudget(contextWindow: number): ContextBudget {
	const window = Number.isFinite(contextWindow) ? Math.max(0, Math.floor(contextWindow)) : 0;
	const small = window > 0 && window < SMALL_CONTEXT_WINDOW;
	const quarter = Math.max(256, Math.floor(window * 0.25));
	const outputTokens = small ? quarter : Math.min(4096, window > 0 ? quarter : 4096);
	const reserveCap = small ? outputTokens : 16384;
	const reserveTokens =
		window > 0
			? Math.min(reserveCap, Math.max(128, window - Math.min(outputTokens, Math.max(1, window - 1))))
			: 16384;
	const keepCap = small ? Math.max(128, Math.floor(window * 0.35)) : 20000;
	const keepRecentTokens = window > 0 ? Math.min(keepCap, Math.max(128, window - reserveTokens - 1)) : 20000;
	return {
		contextWindow: window,
		small,
		outputTokens,
		reserveTokens,
		keepRecentTokens,
	};
}

/** Shrink reserve and keep-recent so they fit inside the window. Larger windows keep their settings. */
export function fitCompactionSettings(settings: CompactionFitSettings, contextWindow: number): CompactionFitSettings {
	if (!(contextWindow > 0)) {
		return settings;
	}
	const budget = contextBudget(contextWindow);
	const reserveTokens = Math.min(settings.reserveTokens, budget.reserveTokens);
	const keepRecentTokens = Math.min(settings.keepRecentTokens, budget.keepRecentTokens);
	if (reserveTokens === settings.reserveTokens && keepRecentTokens === settings.keepRecentTokens) {
		return settings;
	}
	return { enabled: settings.enabled, reserveTokens, keepRecentTokens };
}

export function smallContextPrompt(cwd: string): string {
	return [
		"The context window is small. Keep replies short.",
		"Work in the current folder. Use read, write, edit, and bash.",
		"When asked to build or run something, call a tool. Do not paste a tutorial.",
		"write and edit take a file path, not a folder.",
		`Current folder: ${cwd}`,
	].join("\n");
}
