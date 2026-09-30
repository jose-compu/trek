import { localModelDeterminism, matchLocalModelId } from "../runtime/determinism.ts";
import type { DeterminismSupport, ProviderDeterminism } from "./types.ts";

const TABLE: Record<string, Omit<ProviderDeterminism, "provider">> = {
	faux: { support: "seed", notes: "Test fixture; seed is binding in-process." },
	openai: { support: "best-effort", notes: "Sends seed; log system_fingerprint when present." },
	"azure-openai-responses": {
		support: "best-effort",
		notes: "OpenAI-compatible seed; backend may drift.",
	},
	google: { support: "best-effort", notes: "Gemini seed is documented as best-effort." },
	"google-vertex": { support: "best-effort", notes: "Vertex seed is documented as best-effort." },
	anthropic: { support: "unsupported", notes: "No seed field; temperature=0 is not deterministic." },
	"openai-codex-responses": {
		support: "best-effort",
		notes: "OpenAI Responses path; treat like OpenAI seed.",
	},
	xai: { support: "best-effort", notes: "Grok seed is best-effort when the API accepts it." },
	local: {
		support: "best-effort",
		notes: "Depends on the GGUF and TREK_LLAMA_NGL. Default GPU offload is not bit-exact.",
	},
	mistral: { support: "unsupported", notes: "Hosted Mistral API does not expose a binding seed." },
};

export function getProviderDeterminism(provider: string): ProviderDeterminism {
	const key = provider.trim().toLowerCase();
	const known = TABLE[key];
	if (known) {
		return { provider: key, ...known };
	}
	return {
		provider: key,
		support: "unsupported",
		notes: "Unknown provider; do not assume seed is honored.",
	};
}

export function listProviderDeterminism(): ProviderDeterminism[] {
	return Object.entries(TABLE).map(([provider, rest]) => ({ provider, ...rest }));
}

export function getModelDeterminism(provider: string, modelId?: string): ProviderDeterminism {
	if (provider.trim().toLowerCase() === "local") {
		const local = localModelDeterminism(modelId);
		return { provider: "local", support: local.support, notes: local.notes };
	}
	return getProviderDeterminism(provider);
}

export function isStrictAuditProvider(provider: string): boolean {
	return getProviderDeterminism(provider).support === "seed";
}

export function assertStrictAuditTarget(provider: string, modelId?: string): void {
	const info = getModelDeterminism(provider, modelId);
	if (info.support !== "seed") {
		const id = matchLocalModelId(modelId) ?? modelId;
		const label = info.provider === "local" && id ? `local model "${id}"` : `provider "${provider}"`;
		throw new Error(
			`strict_audit refuses ${label} (${info.support}): ${info.notes} Use a dense local model with TREK_LLAMA_NGL=0, or faux, or switch to mode default.`,
		);
	}
}

export function assertStrictAuditProvider(provider: string): void {
	const info = getProviderDeterminism(provider);
	if (info.support !== "seed") {
		throw new Error(
			`strict_audit refuses provider "${provider}" (${info.support}): ${info.notes} Use a local seed-capable model or switch to mode default.`,
		);
	}
}

export function supportLabel(support: DeterminismSupport): string {
	switch (support) {
		case "seed":
			return "seed honored";
		case "best-effort":
			return "best-effort seed";
		case "unsupported":
			return "no seed";
	}
}
