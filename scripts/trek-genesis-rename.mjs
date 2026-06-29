#!/usr/bin/env node
/**
 * One-time Genesis (0.1.0) rename: Pi Coding Agent → Trek Agent.
 * Run from trek/ root after copying pi-original.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = join(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "prebuilds"]);
const TEXT_EXT = new Set([
	".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".sh", ".yml", ".yaml",
	".html", ".css", ".bat", ".ps1", ".gitignore", ".gitattributes",
]);

/** Longest-first replacements to avoid partial matches. */
const REPLACEMENTS = [
	["@earendil-works/pi-coding-agent/hooks", "@trek/coding-agent/hooks"],
	["@earendil-works/pi-coding-agent", "@trek/coding-agent"],
	["@earendil-works/pi-agent-core", "@trek/agent-core"],
	["@earendil-works/pi-agent-old", "@trek/agent-old"],
	["@earendil-works/pi-ai/oauth", "@trek/ai/oauth"],
	["@earendil-works/pi-ai", "@trek/ai"],
	["@earendil-works/pi-tui", "@trek/tui"],
	["@mariozechner/pi-coding-agent/hooks", "@trek/coding-agent/hooks"],
	["@mariozechner/pi-coding-agent", "@trek/coding-agent"],
	["@mariozechner/pi-agent-core", "@trek/agent-core"],
	["@mariozechner/pi-ai/oauth", "@trek/ai/oauth"],
	["@mariozechner/pi-ai", "@trek/ai"],
	["@mariozechner/pi-tui", "@trek/tui"],
	["@earendil-works/pi-", "@trek/"],
	["pi-monorepo", "trek-monorepo"],
	["pi-extension-", "trek-extension-"],
	["pi-coding-agent", "trek-coding-agent"],
	["pi-agent-core", "trek-agent-core"],
	["pi-debug.log", "trek-debug.log"],
	["~/.pi/", "~/.trek/"],
	["~/.pi", "~/.trek"],
	["/.pi/", "/.trek/"],
	["Project (.pi/)", "Project (.trek/)"],
	["User (~/.pi/agent/)", "User (~/.trek/agent/)"],
	[".pi/settings.json", ".trek/settings.json"],
	[".pi-native-quarantine", ".trek-native-quarantine"],
	["piConfigName", "trekConfigName"],
	['configDir": ".pi"', 'configDir": ".trek"'],
	['"pi": "dist/cli.js"', '"trek": "dist/cli.js"'],
	['"pi-ai": "./dist/cli.js"', '"trek-ai": "./dist/cli.js"'],
	["outfile dist/pi ", "outfile dist/trek "],
	["dist/pi &&", "dist/trek &&"],
	['join(installDirectory, "pi")', 'join(installDirectory, "trek")'],
	['"pi.exe"', '"trek.exe"'],
	['"pi.cmd"', '"trek.cmd"'],
	['"pi")', '"trek")'],
	["spawn(\"pi\",", "spawn(\"trek\","],
	["AUTH_FILE=\"$HOME/.pi/", "AUTH_FILE=\"$HOME/.trek/"],
	["AUTH_BACKUP=\"$HOME/.pi/", "AUTH_BACKUP=\"$HOME/.trek/"],
	["pi-test.sh", "trek-test.sh"],
	["pi-test.ps1", "trek-test.ps1"],
	["pi-test.bat", "trek-test.bat"],
	["# @earendil-works/pi-tui", "# @trek/tui"],
	["internalPackagePrefix = \"@trek/\"", "internalPackagePrefix = \"@trek/\""],
	["rootPackageJson.name !== \"trek-monorepo\"", "rootPackageJson.name !== \"trek-monorepo\""],
	["0.78.0", "0.1.0"],
	["0.0.3", "0.1.0"],
];

function walk(dir, files = []) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const path = join(dir, name);
		const st = statSync(path);
		if (st.isDirectory()) walk(path, files);
		else files.push(path);
	}
	return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
	const ext = extname(file);
	if (!TEXT_EXT.has(ext) && !file.endsWith("npmrc")) continue;
	if (file.endsWith("trek-genesis-rename.mjs")) continue;
	let content = readFileSync(file, "utf8");
	const original = content;
	for (const [from, to] of REPLACEMENTS) {
		content = content.split(from).join(to);
	}
	if (content !== original) {
		writeFileSync(file, content);
		changed++;
	}
}

console.log(`Updated ${changed} files.`);
