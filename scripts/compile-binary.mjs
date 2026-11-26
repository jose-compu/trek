/**
 * Compile one Trek executable and rewrite logosdb so it does not call `bindings`.
 *
 * Usage:
 *   bun scripts/compile-binary.mjs <platform|host> <outfile> [--entry <file> ...]
 *
 * platform: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64, or host.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const loaderPath = path.join(repoRoot, "scripts", "logosdb-compiled-loader.cjs");
const needle = "const bindings = require('bindings')('logosdb');";

function hostPlatform() {
	const map = {
		"darwin-arm64": "darwin-arm64",
		"darwin-x64": "darwin-x64",
		"linux-x64": "linux-x64",
		"linux-arm64": "linux-arm64",
		"win32-x64": "windows-x64",
		"win32-arm64": "windows-arm64",
	};
	const key = `${process.platform}-${process.arch}`;
	const platform = map[key];
	if (!platform) throw new Error(`No Trek binary platform for ${key}`);
	return platform;
}

function parseArgs(argv) {
	const positionals = [];
	const entries = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--entry") {
			const file = argv[++i];
			if (!file) throw new Error("--entry needs a file");
			entries.push(path.resolve(file));
			continue;
		}
		positionals.push(arg);
	}
	const platformArg = positionals[0];
	const outfile = positionals[1];
	if (!platformArg || !outfile) {
		throw new Error("Usage: bun scripts/compile-binary.mjs <platform|host> <outfile> [--entry <file> ...]");
	}
	const platform = platformArg === "host" ? hostPlatform() : platformArg;
	return { platform, outfile: path.resolve(outfile), entries };
}

function injectedLoader() {
	const source = readFileSync(loaderPath, "utf8");
	const start = source.indexOf("// BEGIN INJECT");
	const end = source.indexOf("// END INJECT");
	if (start < 0 || end < 0) throw new Error(`Inject markers missing in ${loaderPath}`);
	return source.slice(start, end);
}

const logosdbPlugin = {
	name: "logosdb-native",
	setup(build) {
		build.onLoad({ filter: /[\\/]logosdb[\\/]lib[\\/]index\.js$/ }, async (args) => {
			const text = await Bun.file(args.path).text();
			if (!text.includes(needle)) {
				throw new Error(`logosdb no longer calls bindings() (${args.path}). Update scripts/compile-binary.mjs.`);
			}
			const contents = text.replace(needle, `${injectedLoader()}\nconst bindings = loadLogosdbNative();`);
			return { contents, loader: "js" };
		});
	},
};

const { platform, outfile, entries } = parseArgs(process.argv.slice(2));
const [major, minor] = Bun.version.split(".").map((part) => Number(part));
if (major < 1 || (major === 1 && minor < 3)) {
	throw new Error(`Bun ${Bun.version} cannot compile this binary. Install Bun 1.3.10 or newer (the release workflow uses 1.3.10).`);
}
const binaryName = platform.startsWith("windows-") ? "trek.exe" : "trek";
if (path.basename(outfile) !== binaryName && entries.length === 0) {
	throw new Error(`Refusing to write a ${platform} binary to ${outfile} (expected ${binaryName})`);
}

const entrypoints =
	entries.length > 0
		? entries
		: [
				path.join(repoRoot, "packages", "coding-agent", "dist", "bun", "cli.js"),
				path.join(repoRoot, "packages", "coding-agent", "src", "utils", "image-resize-worker.ts"),
			];

const result = await Bun.build({
	entrypoints,
	compile: {
		target: `bun-${platform}`,
		outfile,
	},
	plugins: [logosdbPlugin],
});

if (!result.success) {
	const detail = result.logs?.map((log) => log.message).join("\n") || "bun build failed";
	throw new Error(detail);
}

if (!existsSync(outfile)) {
	throw new Error(`Bun ${Bun.version} did not write ${outfile}`);
}

console.log(`compiled ${outfile}`);
