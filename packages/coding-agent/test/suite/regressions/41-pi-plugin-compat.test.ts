import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@trek/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { createAgentSession } from "../../../src/core/sdk.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

describe("Pi plugin compatibility in agent session", () => {
	let tempDir: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `trek-pi-plugin-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("loads a discovered Pi-import extension through the resource loader", async () => {
		const extDir = join(agentDir, "extensions", "pi-import-plugin");
		mkdirSync(extDir, { recursive: true });
		writeFileSync(
			join(extDir, "index.ts"),
			`
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function(pi: ExtensionAPI) {
	pi.registerTool({
		name: "pi_compat_probe",
		label: "Pi compat probe",
		description: "Registered from a Pi-import extension",
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
	});
}
`,
		);

		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const sessionManager = SessionManager.inMemory(tempDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir,
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager,
			sessionManager,
			resourceLoader,
		});
		await session.bindExtensions({});

		expect(session.getAllTools().some((tool) => tool.name === "pi_compat_probe")).toBe(true);
		expect(session.getActiveToolNames()).toContain("pi_compat_probe");
	});

	it("discovers a package with a pi manifest and Pi imports", async () => {
		const packageDir = join(agentDir, "extensions", "npm-style-pi-package");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "main.ts"),
			`
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function(pi: ExtensionAPI) {
	pi.registerCommand("pi-package-probe", {
		description: "From pi manifest package",
		handler: async () => {},
	});
}
`,
		);
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "npm-style-pi-package",
				pi: {
					extensions: ["./main.ts"],
				},
			}),
		);

		const settingsManager = SettingsManager.create(tempDir, agentDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
		await resourceLoader.reload();

		const { extensions, errors } = resourceLoader.getExtensions();
		expect(errors).toEqual([]);
		expect(extensions.some((extension) => extension.commands.has("pi-package-probe"))).toBe(true);
	});
});
