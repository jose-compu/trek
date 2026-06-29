import { trekEnv } from "../utils/trek-env.ts";
import type { SettingsManager } from "./settings-manager.ts";

function isTruthyEnvValue(value: string): boolean {
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isInstallTelemetryEnabled(
	settingsManager: SettingsManager,
	telemetryEnv: string | undefined = trekEnv("TELEMETRY"),
): boolean {
	return telemetryEnv !== undefined ? isTruthyEnvValue(telemetryEnv) : settingsManager.getEnableInstallTelemetry();
}
