/** Read `TREK_<name>` with legacy `PI_<name>` fallback. */
export function trekEnv(name: string): string | undefined {
	return process.env[`TREK_${name}`] ?? process.env[`PI_${name}`];
}

export function isTrekEnvTruthy(name: string): boolean {
	const value = trekEnv(name);
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
