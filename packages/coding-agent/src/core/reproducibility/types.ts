/**
 * Reproducibility policy (ROADMAP 0.7.0 Audit, REFLECTIVE §12).
 *
 * Honest best-effort: log seeds and metadata; do not claim bit-exact replay
 * on closed APIs. `strict_audit` is local / seed-capable providers only.
 */

export type ReproducibilityMode = "default" | "strict_audit";

/** Where the numeric session seed came from (D5). */
export type SeedSource = "default" | "settings" | "env" | "random";

/**
 * How strongly a provider can honor `seed`.
 * - seed: local / faux — seed is sent and treated as binding for audit
 * - best-effort: OpenAI, Gemini — seed accepted, fingerprint/backend may drift
 * - unsupported: Anthropic and others with no seed field
 */
export type DeterminismSupport = "seed" | "best-effort" | "unsupported";

export interface ReproducibilitySettings {
	mode?: ReproducibilityMode;
	/** Number, or `"random"` to generate once per session. */
	seed?: number | "random";
	temperature?: number;
	topP?: number;
}

export interface ResolvedReproducibility {
	mode: ReproducibilityMode;
	seed: number;
	seedSource: SeedSource;
	temperature: number;
	topP: number;
	/** Same as `seed` until CPA is wired in 0.10.0 (#75). */
	cpaSeed: number;
}

export const REPRODUCIBILITY_CUSTOM_TYPE = "trek:reproducibility";
export const REPRODUCIBILITY_SCHEMA_VERSION = 1;
export const DEFAULT_SESSION_SEED = 42;
export const DEFAULT_TEMPERATURE = 0;
export const DEFAULT_TOP_P = 1;

export interface ReproducibilitySessionRecord {
	schemaVersion: typeof REPRODUCIBILITY_SCHEMA_VERSION;
	mode: ReproducibilityMode;
	seed: number;
	seedSource: SeedSource;
	temperature: number;
	topP: number;
	cpaSeed: number;
}

export interface ProviderDeterminism {
	provider: string;
	support: DeterminismSupport;
	notes: string;
}

/** Session JSONL customType for one LLM completion (#73). */
export const AUDIT_STEP_CUSTOM_TYPE = "trek:audit_step";
export const AUDIT_STEP_SCHEMA_VERSION = 1;

/**
 * Audit trail per LLM step (REFLECTIVE §12.4).
 * Hashes are 16-char sha256 prefixes. `retrievedLessonIds` stays empty until 0.11.0 Memory.
 */
export interface AuditStepRecord {
	schemaVersion: typeof AUDIT_STEP_SCHEMA_VERSION;
	stepId: string;
	model: string;
	modelVersion?: string;
	seed: number;
	temperature: number;
	topP: number;
	systemFingerprint?: string;
	providerRequestId?: string;
	inputHash: string;
	outputHash: string;
	toolsAvailableHash: string;
	skillsActiveHash: string;
	retrievedLessonIds: string[];
	timestamp: string;
}
