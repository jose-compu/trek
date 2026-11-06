/**
 * Several TUI processes must not share llama-server port 18080 or load MiniLM in API mode.
 * Run: node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/175-concurrent-sessions.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { createEmbedder, noopEmbedder, shouldLoadMemoryOnnx } from "../../../src/core/memory/embedder.ts";
import { createProbingPortAllocator } from "../../../src/core/runtime/process-manager.ts";

describe("regression #175: concurrent TUI sessions", () => {
	it("does not load ONNX MiniLM in api mode unless TREK_MEMORY_LOCAL=1", async () => {
		expect(shouldLoadMemoryOnnx({}, "api")).toBe(false);
		expect(shouldLoadMemoryOnnx({ TREK_MEMORY_LOCAL: "1" }, "api")).toBe(true);
		expect(shouldLoadMemoryOnnx({}, "local")).toBe(true);
		expect(shouldLoadMemoryOnnx({ TREK_MEMORY_LOCAL: "0" }, "local")).toBe(false);

		const api = createEmbedder({}, { mode: "api" });
		expect(api.dim).toBe(384);
		expect(await api.embed("do not download MiniLM")).toEqual([]);

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
