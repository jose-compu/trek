/**
 * Think/act hierarchy and LM Studio role binding.
 * Run: npx vitest run test/hierarchy-think-act.test.ts --reporter=verbose
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import {
	classifyTask,
	DEFAULT_LMSTUDIO_BASE_URL,
	defaultRuntimeConfig,
	lmStudioChatModel,
	readRuntimeConfigFile,
	resolveRuntime,
	routeComponent,
	selectSessionRole,
	selectThinkRole,
	withHierarchy,
	withRoleOverride,
	writeRuntimeConfigFile,
} from "../src/core/runtime/index.ts";
import { handleModelsCommand } from "../src/models-cli.ts";

function localResolved() {
	return resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" }), {
		frontier: null,
	});
}

describe("think versus act", () => {
	it("classifies mechanical, plan, and deep work", () => {
		expect(classifyTask("fix the typo").kind).toBe("mechanical");
		expect(classifyTask("build a web chess").kind).toBe("plan");
		expect(classifyTask("debug the hard bug").kind).toBe("deep");
		expect(classifyTask("list the files").kind).toBe("act");
	});

	it("uses routeComponent so Act is workhorse and Intend is planning", () => {
		const resolved = localResolved();
		const act = routeComponent({ component: "toolIntent", resolved, complexity: 0.4, depth: 1 });
		const think = routeComponent({ component: "intend", resolved, complexity: 0.4, depth: 0 });
		expect(act.role).toBe("workhorse");
		expect(act.reason).toMatch(/toolIntent uses workhorse/);
		expect(think.role).toBe("planning");
		expect(think.reason).toMatch(/intend uses planning/);
		expect(selectSessionRole({ text: "build a web chess", resolved }).reason).toBe(act.reason);
		expect(selectThinkRole({ text: "build a web chess", resolved })?.reason).toBe(think.reason);
	});

	it("sends deep work to Frontier when the API is available", () => {
		const hybrid = resolveRuntime(withHierarchy(defaultRuntimeConfig(), { mode: "hybrid", suite: "mistral" }), {
			frontier: { provider: "anthropic", modelId: "claude-sonnet" },
		});
		const deep = selectSessionRole({ text: "debug the hard bug in login", resolved: hybrid });
		expect(deep.role).toBe("frontier");
		expect(deep.source).toBe("api");
		expect(deep.reason).toMatch(/complexity/);
		const think = selectThinkRole({ text: "debug the hard bug in login", resolved: hybrid });
		expect(think?.role).toBe("frontier");
		const local = localResolved();
		expect(selectSessionRole({ text: "debug the hard bug", resolved: local }).role).toBe("planning");
	});

	it("keeps api mode on a single session model", () => {
		const api = resolveRuntime(defaultRuntimeConfig(), { frontier: { provider: "xai", modelId: "grok-4" } });
		expect(selectSessionRole({ text: "build a web chess", resolved: api })).toMatchObject({
			role: "frontier",
			source: "api",
			modelId: "grok-4",
		});
		expect(selectThinkRole({ text: "build a web chess", resolved: api })).toBeUndefined();
	});
});

describe("LM Studio roles", () => {
	const previous = process.env[ENV_AGENT_DIR];
	const dirs: string[] = [];

	afterEach(() => {
		if (previous === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = previous;
		}
		while (dirs.length > 0) {
			rmSync(dirs.pop()!, { recursive: true, force: true });
		}
		process.exitCode = undefined;
	});

	it("points one or two roles at LM Studio without llama.cpp", () => {
		const single = lmStudioChatModel({ modelId: "bonsai-27b" });
		expect(single.provider).toBe("lmstudio");
		expect(single.baseUrl).toBe(DEFAULT_LMSTUDIO_BASE_URL);
		expect(single.id).toBe("bonsai-27b");

		const config = withHierarchy(defaultRuntimeConfig(), { mode: "local", suite: "mistral" });
		const one = withRoleOverride(config, "workhorse", {
			source: "lmstudio",
			id: "bonsai-27b",
			thinking: false,
			baseUrl: DEFAULT_LMSTUDIO_BASE_URL,
		});
		const two = withRoleOverride(one, "planning", {
			source: "lmstudio",
			id: "lfm2.5-1.2b-thinking-mlx",
			thinking: true,
			baseUrl: DEFAULT_LMSTUDIO_BASE_URL,
		});
		const resolved = resolveRuntime(two, { frontier: null });
		expect(resolved.roles.workhorse?.source).toBe("lmstudio");
		expect(resolved.roles.planning?.id).toBe("lfm2.5-1.2b-thinking-mlx");
		expect(resolved.requiresHuggingFaceToken).toBe(false);
	});

	it("writes set-lmstudio into models.yaml", async () => {
		const root = mkdtempSync(join(tmpdir(), "trek-lmstudio-"));
		dirs.push(root);
		process.env[ENV_AGENT_DIR] = join(root, "agent");
		const log = console.log;
		console.log = () => {};
		expect(await handleModelsCommand(["models", "set-lmstudio", "--id", "bonsai-27b"])).toBe(true);
		expect(
			await handleModelsCommand(["models", "set-lmstudio", "--workhorse", "act-model", "--planning", "think-model"]),
		).toBe(true);
		console.log = log;
		const saved = readRuntimeConfigFile(join(root, "models.yaml"));
		expect(saved.hierarchy.mode).toBe("local");
		expect(saved.roles.workhorse).toMatchObject({ source: "lmstudio", id: "act-model" });
		expect(saved.roles.planning).toMatchObject({ source: "lmstudio", id: "think-model" });
		writeRuntimeConfigFile(join(root, "models.yaml"), saved);
	});
});
