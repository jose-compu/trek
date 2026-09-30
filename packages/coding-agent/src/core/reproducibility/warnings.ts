import { formatLocalDeterminismTable } from "../runtime/determinism.ts";
import { getModelDeterminism, listProviderDeterminism, supportLabel } from "./providers.ts";
import type { ResolvedReproducibility } from "./types.ts";

export function formatDeterminismWarning(
	provider: string,
	resolved: ResolvedReproducibility,
	modelId?: string,
): string | undefined {
	const info = getModelDeterminism(provider, modelId);
	if (info.support === "seed") {
		return undefined;
	}
	const who = info.provider === "local" && modelId ? `local model "${modelId}"` : `provider "${provider}"`;
	return `Warning: ${who} cannot honor determinism (${supportLabel(info.support)}). ${info.notes} Session seed ${resolved.seed} is logged for audit, not bit-exact replay. Use strict_audit with a dense local model and TREK_LLAMA_NGL=0 for audit-grade determinism.`;
}

export function formatProviderSupportTable(): string {
	const lines = ["Provider determinism support:"];
	for (const row of listProviderDeterminism()) {
		lines.push(`  ${row.provider.padEnd(24)} ${supportLabel(row.support).padEnd(18)} ${row.notes}`);
	}
	lines.push("");
	lines.push(formatLocalDeterminismTable());
	return lines.join("\n");
}

export function formatReproducibilityStatus(resolved: ResolvedReproducibility, provider?: string): string {
	const lines = [
		`mode: ${resolved.mode}`,
		`seed: ${resolved.seed} (${resolved.seedSource})`,
		`temperature: ${resolved.temperature}`,
		`top_p: ${resolved.topP}`,
		`cpaSeed: ${resolved.cpaSeed}`,
	];
	if (provider) {
		const info = getModelDeterminism(provider);
		lines.push(`provider: ${provider} (${supportLabel(info.support)})`);
		const warning = formatDeterminismWarning(provider, resolved);
		if (warning) {
			lines.push(warning);
		}
	}
	return lines.join("\n");
}
