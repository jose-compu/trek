import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	defaultRuntimeConfig,
	type MissingWeight,
	missingLocalWeights,
	offerMissingWeights,
	resolveRuntime,
	withHierarchy,
} from "../src/core/runtime/index.ts";

describe("missing model download", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function localLfm() {
		return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "lfm" }), {
			frontier: null,
		});
	}

	it("lists local chat weights that are not on disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-weights-"));
		dirs.push(dir);
		expect(missingLocalWeights(localLfm(), dir).map((item) => item.id)).toEqual([
			"LFM2.5-350M",
			"LFM2.5-1.2B-Instruct",
			"LFM2.5-8B-A1B",
		]);
		writeFileSync(join(dir, "LFM2.5-350M.gguf"), "GGUF");
		expect(missingLocalWeights(localLfm(), dir).map((item) => item.role)).toEqual(["workhorse", "planning"]);
	});

	it("does not download unless the answer is yes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-weights-"));
		dirs.push(dir);
		const fetched: string[] = [];
		const download = async (item: MissingWeight) => {
			fetched.push(item.id);
		};
		const declined = await offerMissingWeights({
			resolved: localLfm(),
			dir,
			confirm: async () => false,
			download,
		});
		expect(declined).toBe("declined");
		expect(fetched).toEqual([]);

		const accepted = await offerMissingWeights({
			resolved: localLfm(),
			dir,
			confirm: async (message) => message.includes("LFM2.5-8B-A1B"),
			download,
		});
		expect(accepted).toBe("downloaded");
		expect(fetched).toEqual(["LFM2.5-350M", "LFM2.5-1.2B-Instruct", "LFM2.5-8B-A1B"]);
	});

	it("does not ask or download when the terminal is not interactive", async () => {
		const dir = mkdtempSync(join(tmpdir(), "trek-weights-"));
		dirs.push(dir);
		let asked = false;
		const result = await offerMissingWeights({
			resolved: localLfm(),
			dir,
			interactive: false,
			confirm: async () => {
				asked = true;
				return true;
			},
			download: async () => {
				throw new Error("should not download");
			},
		});
		expect(result).toBe("declined");
		expect(asked).toBe(false);
	});
});
