import { describe, expect, it } from "vitest";
import { defaultRuntimeConfig, resolveRuntime, withHierarchy } from "../src/core/runtime/index.ts";
import { localSuiteToolChoice } from "../src/core/runtime/local-work.ts";
import { localServerCommand } from "../src/core/runtime/process-manager.ts";
import { selectSessionRole } from "../src/core/runtime/select-role.ts";
import { suiteChatDialects, toolDialect } from "../src/core/runtime/tool-dialect.ts";
import { missingLocalWeights } from "../src/core/runtime/weight-download.ts";

function resolved(suite: "mistral" | "mistral-pro") {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite }), { frontier: null });
}

describe("Mistral local suite", () => {
	it("keeps Mistral chat roles on the Mistral dialect", () => {
		const rows = suiteChatDialects().filter((row) => row.suite === "mistral" || row.suite === "mistral-pro");
		expect(rows).toEqual([
			{ suite: "mistral", role: "tooling", id: "Qwen3.5-0.8B", dialect: "qwen" },
			{ suite: "mistral", role: "workhorse", id: "Ministral-3-3B-Instruct-2512", dialect: "mistral" },
			{ suite: "mistral", role: "planning", id: "Ministral-3-8B-Reasoning-2512", dialect: "mistral" },
			{ suite: "mistral-pro", role: "tooling", id: "Qwen3.5-0.8B", dialect: "qwen" },
			{ suite: "mistral-pro", role: "workhorse", id: "Devstral-Small-2507", dialect: "mistral" },
			{ suite: "mistral-pro", role: "planning", id: "Ministral-3-8B-Reasoning-2512", dialect: "mistral" },
		]);
		expect(toolDialect("Ministral-3-3B-Instruct-2512")).toBe("mistral");
		expect(toolDialect("Devstral-Small-2507")).toBe("mistral");
		expect(toolDialect("Qwen3.5-0.8B")).toBe("qwen");
	});

	it("starts Act on Tooling for a build and a small fix", () => {
		const mistral = resolved("mistral");
		expect(selectSessionRole({ text: "build a web chess in /tmp/blah", resolved: mistral })).toMatchObject({
			role: "tooling",
			modelId: "Qwen3.5-0.8B",
		});
		expect(selectSessionRole({ text: "fix the typo", resolved: mistral })).toMatchObject({
			role: "tooling",
			modelId: "Qwen3.5-0.8B",
		});
		expect(selectSessionRole({ text: "build the site", resolved: resolved("mistral-pro") }).modelId).toBe(
			"Qwen3.5-0.8B",
		);
	});

	it("does not load the LFM template for a Mistral chat model", () => {
		const previousLlama = process.env.TREK_LLAMA_SERVER;
		const previousMlx = process.env.TREK_MLX;
		process.env.TREK_LLAMA_SERVER = "/bin/echo";
		process.env.TREK_MLX = "1";
		try {
			const command = localServerCommand({
				role: "workhorse",
				modelId: "Ministral-3-3B-Instruct-2512",
				port: 9,
				quant: "q4_k_m",
				endpoint: "http://127.0.0.1:9/v1",
			});
			expect(command.command).toBe("/bin/echo");
			expect(command.args).toContain("--jinja");
			expect(command.args).not.toContain("--chat-template-file");
			expect(command.args.join(" ")).not.toContain("mlx");
		} finally {
			restore("TREK_LLAMA_SERVER", previousLlama);
			restore("TREK_MLX", previousMlx);
		}
	});

	it("requires a tool until the build has written a file and run bash", () => {
		expect(localSuiteToolChoice([{ role: "user", content: "build a web chess" }])).toBe("required");
		expect(
			localSuiteToolChoice([
				{ role: "user", content: "build a web chess" },
				{ role: "assistant", content: [{ type: "toolCall", name: "write" }] },
				{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] },
			]),
		).toBeUndefined();
	});

	it("lists Tooling and Devstral when the pro suite directory is empty", () => {
		const missing = missingLocalWeights(resolved("mistral-pro"), "/tmp/trek-mistral-empty");
		expect(missing.map((item) => item.id)).toEqual([
			"Qwen3.5-0.8B",
			"Devstral-Small-2507",
			"Ministral-3-8B-Reasoning-2512",
		]);
	});
});

function restore(key: "TREK_LLAMA_SERVER" | "TREK_MLX", value: string | undefined) {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}
