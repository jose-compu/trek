import { getProviderDeterminism, listProviderDeterminism, supportLabel } from "./providers.ts";
import type { ResolvedReproducibility } from "./types.ts";

export function formatDeterminismWarning(provider: string, resolved: ResolvedReproducibility): string | undefined {
	const info = getProviderDeterminism(provider);
	if (info.support === "seed") {
		return undefined;
	}
	return `Warning: provider "${provider}" cannot honor determinism (${supportLabel(info.support)}). ${info.notes} Session seed ${resolved.seed} is logged for audit, not bit-exact replay. Use strict_audit with a local seed-capable model for audit-grade determinism.`;
}

export function formatProviderSupportTable(): string {
	const lines = ["Provider determinism support:"];
	for (const row of listProviderDeterminism()) {
		lines.push(`  ${row.provider.padEnd(24)} ${supportLabel(row.support).padEnd(18)} ${row.notes}`);
	}
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
		const info = getProviderDeterminism(provider);
		lines.push(`provider: ${provider} (${supportLabel(info.support)})`);
		const warning = formatDeterminismWarning(provider, resolved);
		if (warning) {
			lines.push(warning);
		}
	}
	return lines.join("\n");
}
