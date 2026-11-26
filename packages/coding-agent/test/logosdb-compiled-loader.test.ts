/**
 * Compiled Trek must not ask the bindings package to walk B:/~BUN.
 * Run: npx vitest run test/logosdb-compiled-loader.test.ts --reporter=verbose
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const loader = require(
	join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/logosdb-compiled-loader.cjs"),
) as {
	isBunVirtualPath: (file: string) => boolean;
	logosdbSidecar: (execPath: string) => string;
	loadLogosdbNative: (deps?: {
		fs?: { existsSync: (file: string) => boolean };
		path?: { join: (...parts: string[]) => string; dirname: (file: string) => string };
		execPath?: string;
		filename?: string;
		dlopen?: (mod: { exports: unknown }, file: string) => void;
		bindings?: (name: string) => unknown;
	}) => unknown;
};

describe("logosdb compiled loader", () => {
	it("recognizes Bun's virtual executable path", () => {
		expect(loader.isBunVirtualPath("B:/~BUN/root/trek.exe")).toBe(true);
		expect(loader.isBunVirtualPath("/$bunfs/root/trek")).toBe(true);
		expect(loader.isBunVirtualPath("C:/Program Files/Trek/trek.exe")).toBe(false);
	});

	it("looks for native/logosdb.node beside the real executable", () => {
		expect(loader.logosdbSidecar("C:/Program Files/Trek/trek.exe")).toBe(
			join("C:/Program Files/Trek", "native", "logosdb.node"),
		);
	});

	it("dlopens the sidecar and does not call bindings", () => {
		const bindings = vi.fn();
		const dlopen = vi.fn((mod: { exports: unknown }) => {
			mod.exports = { DB: function DB() {} };
		});
		const exports = loader.loadLogosdbNative({
			execPath: "C:/Program Files/Trek/trek.exe",
			filename: "B:/~BUN/root/trek.exe",
			fs: { existsSync: () => true },
			dlopen,
			bindings,
		});
		expect(bindings).not.toHaveBeenCalled();
		expect(dlopen).toHaveBeenCalledWith(expect.anything(), join("C:/Program Files/Trek", "native", "logosdb.node"));
		expect(exports).toEqual({ DB: expect.any(Function) });
	});

	it("throws the virtual-path error instead of calling bindings when the sidecar is missing", () => {
		const bindings = vi.fn();
		expect(() =>
			loader.loadLogosdbNative({
				execPath: "C:/Program Files/Trek/trek.exe",
				filename: "B:/~BUN/root/trek.exe",
				fs: { existsSync: () => false },
				bindings,
			}),
		).toThrow(/native\/logosdb\.node/);
		expect(bindings).not.toHaveBeenCalled();
	});

	it("still uses bindings for a real Node tree", () => {
		const bindings = vi.fn(() => ({ DB: function DB() {} }));
		const exports = loader.loadLogosdbNative({
			execPath: "/usr/local/bin/node",
			filename: "/work/node_modules/logosdb/lib/index.js",
			fs: { existsSync: () => false },
			bindings,
		});
		expect(bindings).toHaveBeenCalledWith("logosdb");
		expect(exports).toEqual({ DB: expect.any(Function) });
	});
});
