import chalk from "chalk";
import { APP_NAME, getAgentDir } from "./config.ts";
import {
	formatProviderSupportTable,
	formatReproducibilityStatus,
	type ReproducibilityMode,
	type ReproducibilitySettings,
	readReproducibilityEnv,
	resolveReproducibility,
} from "./core/reproducibility/index.ts";
import { SettingsManager } from "./core/settings-manager.ts";

function printHelp(): void {
	console.log(`${APP_NAME} config reproducibility`);
	console.log(`${APP_NAME} config reproducibility --mode default|strict_audit`);
	console.log(`${APP_NAME} config reproducibility --seed 42`);
	console.log(`${APP_NAME} config reproducibility --seed random`);
	console.log("  Show or persist reproducibility mode and session seed (0.7.0 Audit).");
	console.log("  Without flags, prints the current settings and provider support table.");
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index >= 0 && args[index + 1]) {
		return args[index + 1];
	}
	return undefined;
}

function parseModeFlag(value: string | undefined): ReproducibilityMode | undefined {
	if (value === "default" || value === "strict_audit") {
		return value;
	}
	return undefined;
}

function parseSeedFlag(value: string | undefined): number | "random" | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "random") {
		return "random";
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return undefined;
	}
	return parsed;
}

export async function handleReproducibilityConfig(args: string[]): Promise<boolean> {
	if (args[0] !== "config" || args[1] !== "reproducibility") {
		return false;
	}

	const rest = args.slice(2);
	if (rest.includes("--help") || rest.includes("-h")) {
		printHelp();
		return true;
	}

	const settingsManager = SettingsManager.create(process.cwd(), getAgentDir());
	const current = settingsManager.getReproducibilitySettings();
	const next: ReproducibilitySettings = { ...current };
	let changed = false;

	const modeFlag = flagValue(rest, "--mode");
	if (modeFlag !== undefined) {
		const mode = parseModeFlag(modeFlag);
		if (!mode) {
			console.error(chalk.red(`Invalid --mode ${modeFlag}. Use default or strict_audit.`));
			process.exitCode = 1;
			return true;
		}
		next.mode = mode;
		changed = true;
	}

	const seedFlag = flagValue(rest, "--seed");
	if (rest.includes("--seed")) {
		const seed = parseSeedFlag(seedFlag);
		if (seed === undefined) {
			console.error(chalk.red("Invalid --seed. Use a non-negative integer or random."));
			process.exitCode = 1;
			return true;
		}
		next.seed = seed;
		changed = true;
	}

	if (changed) {
		settingsManager.setReproducibilitySettings(next);
		await settingsManager.flush();
	}

	const resolved = resolveReproducibility({
		settings: settingsManager.getReproducibilitySettings(),
		env: readReproducibilityEnv(),
	});
	console.log(formatReproducibilityStatus(resolved));
	console.log("");
	console.log(formatProviderSupportTable());
	return true;
}
