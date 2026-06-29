import { afterEach, describe, expect, test } from "vitest";
import { isTrekEnvTruthy, trekEnv } from "../src/utils/trek-env.ts";

describe("trekEnv", () => {
	afterEach(() => {
		delete process.env.TREK_ALLOW_LOCKFILE_CHANGE;
		delete process.env.PI_ALLOW_LOCKFILE_CHANGE;
	});

	test("prefers TREK_ over PI_ legacy name", () => {
		process.env.PI_ALLOW_LOCKFILE_CHANGE = "legacy";
		process.env.TREK_ALLOW_LOCKFILE_CHANGE = "trek";
		expect(trekEnv("ALLOW_LOCKFILE_CHANGE")).toBe("trek");
	});

	test("falls back to PI_ when TREK_ is unset", () => {
		process.env.PI_ALLOW_LOCKFILE_CHANGE = "1";
		expect(isTrekEnvTruthy("ALLOW_LOCKFILE_CHANGE")).toBe(true);
	});
});
