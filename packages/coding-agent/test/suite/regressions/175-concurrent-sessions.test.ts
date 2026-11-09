/**
 * Several TUI processes must not share llama-server port 18080.
 * Memory prefers MiniLM even in API mode; TREK_MEMORY_LOCAL=0 skips ONNX.
 * Run: node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/175-concurrent-sessions.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { createEmbedder, noopEmbedder, shouldLoadMemoryOnnx } from "../../../src/core/memory/embedder.ts";
import { createProbingPortAllocator } from "../../../src/core/runtime/process-manager.ts";

describe("regression #175: concurrent TUI sessions", () => {
	it("prefers MiniLM in api mode and skips ONNX only when TREK_MEMORY_LOCAL=0", async () => {
		expect(shouldLoadMemoryOnnx({}, "api")).toBe(true);
		expect(shouldLoadMemoryOnnx({ TREK_MEMORY_LOCAL: "1" }, "api")).toBe(true);
		expect(shouldLoadMemoryOnnx({ TREK_MEMORY_LOCAL: "0" }, "api")).toBe(false);
		expect(shouldLoadMemoryOnnx({}, "local")).toBe(true);
		expect(shouldLoadMemoryOnnx({ TREK_MEMORY_LOCAL: "0" }, "local")).toBe(false);

		const api = createEmbedder({}, { mode: "api" });
		expect(api.dim).toBe(384);
		const semantic = await api.embed("do not download MiniLM");
		expect(semantic).toHaveLength(384);
		expect(semantic.some((value) => value !== 0)).toBe(true);

		const lexical = createEmbedder({ TREK_MEMORY_LOCAL: "0" }, { mode: "api" });
		expect(lexical.dim).toBe(384);
		expect(await lexical.embed("bag of words only")).toHaveLength(384);

		const off = createEmbedder({ TREK_MEMORY_EMBEDDER: "off" }, { mode: "api" });
		expect(await off.embed("x")).toEqual([]);

		const skipped = noopEmbedder();
		expect(skipped.dim).toBe(384);
		expect(await skipped.embed("x")).toEqual([]);
	});

	it("gives each process a free llama-server port after 18080", () => {
		const taken = new Set([18080]);
		const first = createProbingPortAllocator(18080, (port) => !taken.has(port));
		const portA = first();
		taken.add(portA);
		const second = createProbingPortAllocator(18080, (port) => !taken.has(port));
		const portB = second();
		expect(portA).toBe(18081);
		expect(portB).toBe(18082);
		expect(portA).not.toBe(portB);
	});
});
