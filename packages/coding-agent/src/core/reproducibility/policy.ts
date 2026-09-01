import { randomInt } from "node:crypto";
import { trekEnv } from "../../utils/trek-env.ts";
import {
	DEFAULT_SESSION_SEED,
	DEFAULT_TEMPERATURE,
	DEFAULT_TOP_P,
	REPRODUCIBILITY_SCHEMA_VERSION,
	type ReproducibilityMode,
	type ReproducibilitySessionRecord,
	type ReproducibilitySettings,
	type ResolvedReproducibility,
	type SeedSource,
} from "./types.ts";

export interface ReproducibilityEnv {
	seed?: string;
	mode?: string;
}

export interface ResolveReproducibilityInput {
	settings?: ReproducibilitySettings;
	env?: ReproducibilityEnv;
	/** Override RNG for tests. Default: crypto.randomInt. */
	random?: () => number;
}

function parseMode(value: string | undefined): ReproducibilityMode | undefined {
	if (value === "default" || value === "strict_audit") {
		return value;
	}
	return undefined;
}

function parseSeedToken(value: string | undefined): number | "random" | undefined {
	if (value === undefined || value.trim() === "") {
		return undefined;
	}
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "random") {
		return "random";
	}
	const parsed = Number(trimmed);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return undefined;
	}
	return parsed;
}

function generateSessionSeed(random: () => number): number {
	return random();
}

export function readReproducibilityEnv(): ReproducibilityEnv {
	return {
		seed: trekEnv("SEED"),
		mode: trekEnv("REPRODUCIBILITY_MODE"),
	};
}

export function defaultRandomSeed(): number {
	return randomInt(0, 2 ** 31);
}

/**
 * Resolve mode, numeric session seed, and sampling flags (D5).
 * Precedence: env > settings > defaults (seed 42, mode default, temp 0, top_p 1).
 */
export function resolveReproducibility(input: ResolveReproducibilityInput = {}): ResolvedReproducibility {
	const settings = input.settings ?? {};
	const env = input.env ?? {};
	const random = input.random ?? defaultRandomSeed;

	const mode = parseMode(env.mode) ?? parseMode(settings.mode) ?? "default";

	const envSeed = parseSeedToken(env.seed);
	const settingsSeed = settings.seed;
	let seed: number;
	let seedSource: SeedSource;

	if (envSeed === "random") {
		seed = generateSessionSeed(random);
		seedSource = "random";
	} else if (typeof envSeed === "number") {
		seed = envSeed;
		seedSource = "env";
	} else if (settingsSeed === "random") {
		seed = generateSessionSeed(random);
		seedSource = "random";
	} else if (typeof settingsSeed === "number" && Number.isInteger(settingsSeed) && settingsSeed >= 0) {
		seed = settingsSeed;
		seedSource = "settings";
	} else {
		seed = DEFAULT_SESSION_SEED;
		seedSource = "default";
	}

	const temperature =
		typeof settings.temperature === "number" && Number.isFinite(settings.temperature)
			? settings.temperature
			: DEFAULT_TEMPERATURE;
	const topP = typeof settings.topP === "number" && Number.isFinite(settings.topP) ? settings.topP : DEFAULT_TOP_P;

	return {
		mode,
		seed,
		seedSource,
		temperature,
		topP,
		cpaSeed: seed,
	};
}

/** CPA scheduler seed — same as the session seed until 0.10.0 (#75). */
export function getCpaPrngSeed(resolved: ResolvedReproducibility): number {
	return resolved.cpaSeed;
}

export function toSessionRecord(resolved: ResolvedReproducibility): ReproducibilitySessionRecord {
	return {
		schemaVersion: REPRODUCIBILITY_SCHEMA_VERSION,
		mode: resolved.mode,
		seed: resolved.seed,
		seedSource: resolved.seedSource,
		temperature: resolved.temperature,
		topP: resolved.topP,
		cpaSeed: resolved.cpaSeed,
	};
}

export function parseSessionRecord(data: unknown): ReproducibilitySessionRecord | undefined {
	if (!data || typeof data !== "object") {
		return undefined;
	}
	const raw = data as Record<string, unknown>;
	if (raw.schemaVersion !== REPRODUCIBILITY_SCHEMA_VERSION) {
		return undefined;
	}
	if (raw.mode !== "default" && raw.mode !== "strict_audit") {
		return undefined;
	}
	if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed)) {
		return undefined;
	}
	if (
		raw.seedSource !== "default" &&
		raw.seedSource !== "settings" &&
		raw.seedSource !== "env" &&
		raw.seedSource !== "random"
	) {
		return undefined;
	}
	if (typeof raw.temperature !== "number" || typeof raw.topP !== "number") {
		return undefined;
	}
	if (typeof raw.cpaSeed !== "number" || !Number.isInteger(raw.cpaSeed)) {
		return undefined;
	}
	return {
		schemaVersion: REPRODUCIBILITY_SCHEMA_VERSION,
		mode: raw.mode,
		seed: raw.seed,
		seedSource: raw.seedSource,
		temperature: raw.temperature,
		topP: raw.topP,
		cpaSeed: raw.cpaSeed,
	};
}
