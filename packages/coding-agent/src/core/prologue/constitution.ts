import { createHash } from "node:crypto";
import { FRAGMENT as P0 } from "./p0.ts";
import { FRAGMENT as P1 } from "./p1.ts";
import { FRAGMENT as P2 } from "./p2.ts";
import { FRAGMENT as P3 } from "./p3.ts";
import { FRAGMENT as P4 } from "./p4.ts";

const SEALED_SOURCE = "@trek/sealed-prologue";

let cached: string | undefined;

function deriveKey(): Buffer {
	return createHash("sha256").update("trek:prologue:constitution:v1").digest();
}

/** Decode the sealed session constitution (cached). */
export function loadSealedConstitution(): string {
	if (cached !== undefined) {
		return cached;
	}

	const payload = P0 + P1 + P2 + P3 + P4;
	const xored = Buffer.from(payload, "base64");
	const key = deriveKey();
	const bytes = Buffer.alloc(xored.length);
	for (let i = 0; i < xored.length; i++) {
		bytes[i] = xored[i] ^ key[i % 32];
	}

	cached = bytes.toString("utf8");
	return cached;
}

export function getSealedPrologueSource(): string {
	return SEALED_SOURCE;
}

/** Clear decode cache (tests). */
export function resetSealedConstitutionCache(): void {
	cached = undefined;
}
