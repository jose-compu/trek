import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";

const PI_CODING_AGENT_IMPORTS = [
	"@earendil-works/pi-coding-agent",
	"@mariozechner/pi-coding-agent",
	"@trek/coding-agent",
] as const;

const PI_AGENT_CORE_IMPORTS = [
	"@earendil-works/pi-agent-core",
	"@mariozechner/pi-agent-core",
	"@trek/agent-core",
] as const;

const PI_AI_IMPORTS = ["@earendil-works/pi-ai", "@mariozechner/pi-ai", "@trek/ai"] as const;

const PI_AI_OAUTH_IMPORTS = ["@earendil-works/pi-ai/oauth", "@mariozechner/pi-ai/oauth", "@trek/ai/oauth"] as const;

const PI_TUI_IMPORTS = ["@earendil-works/pi-tui", "@mariozechner/pi-tui", "@trek/tui"] as const;

function extensionWithPiImports(options: {
	codingAgentImport: string;
	agentCoreImport: string;
	aiImport: string;
	aiOauthImport: string;
	tuiImport: string;
	commandName: string;
}): string {
	return `
import type { ExtensionAPI } from "${options.codingAgentImport}";
import { Agent } from "${options.agentCoreImport}";
import { getModel } from "${options.aiImport}";
import type { OAuthProvider } from "${options.aiOauthImport}";
import { Text } from "${options.tuiImport}";

void Agent;
void getModel;
void Text;
type _OAuthProvider = OAuthProvider;

export default function(pi: ExtensionAPI) {
	pi.registerCommand("${options.commandName}", {
		description: "Pi plugin compat probe",
		handler: async () => {},
	});
}
`;
}

describe("Pi plugin compatibility", () => {
	let tempDir: string;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trek-pi-plugin-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads extensions that import Pi package names instead of @trek/*", async () => {
		for (const [index, codingAgentImport] of PI_CODING_AGENT_IMPORTS.entries()) {
			const extPath = path.join(extensionsDir, `pi-shim-${index}.ts`);
			fs.writeFileSync(
				extPath,
				extensionWithPiImports({
					codingAgentImport,
					agentCoreImport: PI_AGENT_CORE_IMPORTS[index],
					aiImport: PI_AI_IMPORTS[index],
					aiOauthImport: PI_AI_OAUTH_IMPORTS[index],
					tuiImport: PI_TUI_IMPORTS[index],
					commandName: `pi-shim-${index}`,
				}),
			);
		}

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(PI_CODING_AGENT_IMPORTS.length);
	});

	it("loads a typical Pi-style plugin using @earendil-works imports", async () => {
		fs.writeFileSync(
			path.join(extensionsDir, "pi-style-plugin.ts"),
			extensionWithPiImports({
				codingAgentImport: "@earendil-works/pi-coding-agent",
				agentCoreImport: "@earendil-works/pi-agent-core",
				aiImport: "@earendil-works/pi-ai",
				aiOauthImport: "@earendil-works/pi-ai/oauth",
				tuiImport: "@earendil-works/pi-tui",
				commandName: "pi-style-probe",
			}),
		);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		expect(result.extensions[0]?.commands.has("pi-style-probe")).toBe(true);
	});

	it("loads a typical Pi-style plugin using @mariozechner imports", async () => {
		fs.writeFileSync(
			path.join(extensionsDir, "legacy-pi-plugin.ts"),
			extensionWithPiImports({
				codingAgentImport: "@mariozechner/pi-coding-agent",
				agentCoreImport: "@mariozechner/pi-agent-core",
				aiImport: "@mariozechner/pi-ai",
				aiOauthImport: "@mariozechner/pi-ai/oauth",
				tuiImport: "@mariozechner/pi-tui",
				commandName: "legacy-pi-probe",
			}),
		);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		expect(result.extensions[0]?.commands.has("legacy-pi-probe")).toBe(true);
	});

	it("discovers package.json trek manifest entries", async () => {
		const packageDir = path.join(extensionsDir, "trek-manifest-package");
		fs.mkdirSync(packageDir, { recursive: true });
		fs.writeFileSync(
			path.join(packageDir, "main.ts"),
			`
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
	pi.registerCommand("trek-manifest-probe", { handler: async () => {} });
}
`,
		);
		fs.writeFileSync(
			path.join(packageDir, "package.json"),
			JSON.stringify({
				name: "trek-manifest-package",
				trek: {
					extensions: ["./main.ts"],
				},
			}),
		);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		expect(result.extensions[0]?.commands.has("trek-manifest-probe")).toBe(true);
	});

	it("prefers package.json trek manifest over pi when both are present", async () => {
		const packageDir = path.join(extensionsDir, "dual-manifest-package");
		fs.mkdirSync(packageDir, { recursive: true });
		fs.writeFileSync(
			path.join(packageDir, "trek-entry.ts"),
			`
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
	pi.registerCommand("from-trek-manifest", { handler: async () => {} });
}
`,
		);
		fs.writeFileSync(
			path.join(packageDir, "pi-entry.ts"),
			`
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
	pi.registerCommand("from-pi-manifest", { handler: async () => {} });
}
`,
		);
		fs.writeFileSync(
			path.join(packageDir, "package.json"),
			JSON.stringify({
				name: "dual-manifest-package",
				trek: {
					extensions: ["./trek-entry.ts"],
				},
				pi: {
					extensions: ["./pi-entry.ts"],
				},
			}),
		);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		expect(result.extensions[0]?.commands.has("from-trek-manifest")).toBe(true);
		expect(result.extensions[0]?.commands.has("from-pi-manifest")).toBe(false);
	});
});
