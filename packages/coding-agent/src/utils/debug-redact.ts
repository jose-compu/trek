/**
 * Redact secrets before they hit trek-debug.log (argv, payloads, free text).
 */

const REDACTED = "[redacted]";

/** CLI flags whose following value (or =value) must not be logged. */
const SECRET_ARGV_FLAGS = new Set([
	"--api-key",
	"--api_key",
	"--token",
	"--access-token",
	"--auth-token",
	"--password",
	"--secret",
]);

/** Object keys treated as secret when logging structured debug data. */
const SECRET_OBJECT_KEYS = /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|authorization|password|secret|token|key)$/i;

/**
 * Provider-shaped secrets (hyphen and underscore forms):
 * sk-…, sk-ant-…, sk-or-v1-…, xai-…, ghp_…, hf_…, gsk_…, csk-…
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
	/\bsk-(?:ant-|or-v1-)?[A-Za-z0-9_-]{8,}\b/g,
	/\bxai-[A-Za-z0-9_-]{8,}\b/g,
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{8,}\b/g,
	/\bhf_[A-Za-z0-9_]{8,}\b/g,
	/\bgsk_[A-Za-z0-9_]{8,}\b/g,
	/\bcsk-[A-Za-z0-9_-]{8,}\b/g,
	/\b(?:sk|xai|hf|ghp)_[A-Za-z0-9_-]{8,}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
];

export function redactSecretText(text: string): string {
	let out = text;
	for (const pattern of SECRET_VALUE_PATTERNS) {
		out = out.replace(pattern, REDACTED);
	}
	return out;
}

/** Redact secret flag values in a CLI argv array (copies; does not mutate input). */
export function redactArgv(argv: readonly string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		const eq = arg.indexOf("=");
		if (eq > 0) {
			const flag = arg.slice(0, eq);
			if (SECRET_ARGV_FLAGS.has(flag)) {
				out.push(`${flag}=${REDACTED}`);
				continue;
			}
		}
		if (SECRET_ARGV_FLAGS.has(arg)) {
			out.push(arg);
			if (i + 1 < argv.length) {
				out.push(REDACTED);
				i++;
			}
			continue;
		}
		out.push(redactSecretText(arg));
	}
	return out;
}

export function redactDebugData(data: unknown): unknown {
	if (data === null || data === undefined) {
		return data;
	}
	if (typeof data === "string") {
		return redactSecretText(data);
	}
	if (typeof data === "number" || typeof data === "boolean") {
		return data;
	}
	if (Array.isArray(data)) {
		if (data.every((item) => typeof item === "string")) {
			return redactArgv(data as string[]);
		}
		return data.map((item) => redactDebugData(item));
	}
	if (typeof data === "object") {
		const record = data as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(record)) {
			if (SECRET_OBJECT_KEYS.test(key)) {
				out[key] = REDACTED;
				continue;
			}
			if (key === "argv" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
				out[key] = redactArgv(value as string[]);
				continue;
			}
			out[key] = redactDebugData(value);
		}
		return out;
	}
	return data;
}
