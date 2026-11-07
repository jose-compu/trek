import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LayeringDialect } from "../../../src/core/runtime/layer-decision.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function layeringFixtureRoot(): string {
	return join(here, "fixtures");
}

export function loadLayeringCase(
	dialect: LayeringDialect,
	role: string,
	pack: string,
): {
	prompt: string;
	response: unknown;
	expect: Record<string, unknown>;
} {
	const dir = join(layeringFixtureRoot(), dialect, role, pack);
	return {
		prompt: readFileSync(join(dir, "prompt.txt"), "utf8"),
		response: JSON.parse(readFileSync(join(dir, "response.json"), "utf8")) as unknown,
		expect: JSON.parse(readFileSync(join(dir, "expect.json"), "utf8")) as Record<string, unknown>,
	};
}
