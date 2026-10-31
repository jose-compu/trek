import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultRuntimeConfig, resolveRuntime, withHierarchy } from "../src/core/runtime/index.ts";
import { localLlamaChatModel } from "../src/core/runtime/local-model.ts";
import { missingMlxWeights, offerMissingMlx, preferMlx, useMlx } from "../src/core/runtime/mlx-backend.ts";
import { localServerCommand, waitForLocalServer } from "../src/core/runtime/process-manager.ts";

describe("MLX on Apple Silicon", () => {
	const dirs: string[] = [];
	const previous = {
		mlx: process.env.TREK_MLX,
		dir: process.env.TREK_MODELS_DIR,
		server: process.env.TREK_MLX_SERVER,
		llama: process.env.TREK_LLAMA_SERVER,
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		restore("TREK_MLX", previous.mlx);
		restore("TREK_MODELS_DIR", previous.dir);
		restore("TREK_MLX_SERVER", previous.server);
		restore("TREK_LLAMA_SERVER", previous.llama);
	});

	it("stays on llama.cpp when MLX is off", () => {
		expect(preferMlx({ TREK_MLX: "0" })).toBe(false);
		expect(preferMlx({ TREK_MLX: "1" })).toBe(true);
		const resolved = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "lfm" }), {
			frontier: null,
		});
		const dir = mkdtempSync(join(tmpdir(), "trek-mlx-"));
		dirs.push(dir);
		process.env.TREK_MLX = "0";
		process.env.TREK_MODELS_DIR = dir;
		expect(missingMlxWeights(resolved)).toEqual([]);
	});

	it("uses the MLX server when the 4-bit snapshot is on disk", async () => {
		const resolved = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "lfm" }), {
			frontier: null,
		});
		const dir = mkdtempSync(join(tmpdir(), "trek-mlx-"));
		dirs.push(dir);
		process.env.TREK_MLX = "1";
		process.env.TREK_MODELS_DIR = dir;
		process.env.TREK_MLX_SERVER = "/bin/echo";
		const missing = missingMlxWeights(resolved);
		expect(missing.map((item) => item.id)).toEqual(["LFM2.5-350M", "LFM2.5-1.2B-Instruct", "LFM2.5-8B-A1B"]);
		const declined = await offerMissingMlx({
			resolved,
			confirm: async () => false,
			download: async () => {
				throw new Error("should not download");
			},
		});
		expect(declined).toBe("declined");

		const snapshot = join(dir, "mlx", "LFM2.5-1.2B-Instruct");
		mkdirSync(snapshot, { recursive: true });
		writeFileSync(join(snapshot, "config.json"), "{}");
		expect(useMlx("LFM2.5-1.2B-Instruct")).toBe(false);
		const planning = join(dir, "mlx", "LFM2.5-8B-A1B");
		mkdirSync(planning, { recursive: true });
		writeFileSync(join(planning, "config.json"), "{}");
		expect(useMlx("LFM2.5-8B-A1B")).toBe(true);
		const command = localServerCommand({
			role: "planning",
			modelId: "LFM2.5-8B-A1B",
			port: 18401,
			quant: "q4_k_m",
			endpoint: "http://127.0.0.1:18401/v1",
		});
		expect(command.command).toBe("/bin/echo");
		expect(command.args).toContain(planning);
		expect(command.args).toContain("18401");
		expect(command.args).not.toContain("--jinja");
		expect(readFileSync(join(planning, "chat_template.jinja"), "utf8")).toContain("<|tool_call_start|>");
		writeFileSync(join(dir, "LFM2.5-8B-A1B.gguf"), "not-a-snapshot");
		const model = localLlamaChatModel({ modelId: "LFM2.5-8B-A1B", endpoint: "http://127.0.0.1:18401/v1" });
		expect(model.id).toBe(planning);
		expect(model.name).toBe("LFM2.5-8B-A1B");
	});

	it("waits through 503 Loading model and fails a rejected MLX request at once", () => {
		process.env.TREK_MLX = "0";
		let calls = 0;
		let clock = 0;
		waitForLocalServer(
			{ port: 9, modelId: "LFM2.5-1.2B-Instruct" },
			{
				timeoutMs: 1_000,
				now: () => clock,
				sleep: (ms) => {
					clock += ms;
				},
				probe: () => {
					calls += 1;
					return calls < 3 ? { status: 503, body: "Loading model" } : { status: 200, body: "ok" };
				},
			},
		);
		expect(calls).toBe(3);

		const dir = mkdtempSync(join(tmpdir(), "trek-mlx-"));
		dirs.push(dir);
		process.env.TREK_MLX = "1";
		process.env.TREK_MODELS_DIR = dir;
		process.env.TREK_MLX_SERVER = "/bin/echo";
		mkdirSync(join(dir, "mlx", "LFM2.5-8B-A1B"), { recursive: true });
		writeFileSync(join(dir, "mlx", "LFM2.5-8B-A1B", "config.json"), "{}");
		expect(() =>
			waitForLocalServer(
				{ port: 9, modelId: "LFM2.5-8B-A1B" },
				{
					probe: () => ({ status: 404, body: "Not a directory" }),
				},
			),
		).toThrow(/rejected the request/);
	});
});

function restore(
	key: "TREK_MLX" | "TREK_MODELS_DIR" | "TREK_MLX_SERVER" | "TREK_LLAMA_SERVER",
	value: string | undefined,
) {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}
