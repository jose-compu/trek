/**
 * PATH probe for the 0.19 Unix kit. Cache once. Never download a missing tool.
 */

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { getShellEnv } from "../../utils/shell.ts";

export const FIRST_CLASS_UNIX_TOOLS = ["ex", "vim", "ed", "sed", "awk", "rg", "jq", "diff", "patch"] as const;
export const OPTIONAL_UNIX_TOOLS = ["sg", "mlr", "sqlite3"] as const;
export const UNIX_TOOLS = [...FIRST_CLASS_UNIX_TOOLS, ...OPTIONAL_UNIX_TOOLS] as const;

export type FirstClassUnixTool = (typeof FIRST_CLASS_UNIX_TOOLS)[number];
export type OptionalUnixTool = (typeof OPTIONAL_UNIX_TOOLS)[number];
export type UnixToolId = (typeof UNIX_TOOLS)[number];
export type SedFlavor = "bsd" | "gnu" | "unknown";

export interface UnixToolPresence {
	id: UnixToolId;
	present: boolean;
	path?: string;
	flavor?: SedFlavor;
	optional: boolean;
}

export interface UnixToolReport {
	tools: readonly UnixToolPresence[];
}

export interface FindOnPathOptions {
	extensions?: readonly string[];
	isPresent?: (candidate: string) => boolean;
}

export interface ProbeUnixToolsOptions {
	PATH?: string;
	resolve?: (name: UnixToolId) => string | undefined;
	flavorOf?: (bin: string) => SedFlavor;
	extensions?: readonly string[];
	isPresent?: (candidate: string) => boolean;
}

const OPTIONAL = new Set<string>(OPTIONAL_UNIX_TOOLS);

export function isOptionalUnixTool(id: UnixToolId): boolean {
	return OPTIONAL.has(id);
}

export function unixKitPath(pathEnv?: string): string {
	if (pathEnv !== undefined) {
		return pathEnv;
	}
	const env = getShellEnv();
	const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	return env[pathKey] ?? "";
}

export function pathExtensions(platform = process.platform, pathext = process.env.PATHEXT): readonly string[] {
	if (platform !== "win32") {
		return [];
	}
	return (pathext ?? ".EXE;.CMD;.BAT")
		.split(";")
		.map((ext) => ext.trim())
		.filter((ext) => ext.length > 0);
}

export function isUnixToolPresent(candidate: string): boolean {
	try {
		const st = statSync(candidate);
		if (!st.isFile()) {
			return false;
		}
		if (process.platform === "win32") {
			return true;
		}
		return (st.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

function namesOnPath(name: string, extensions: readonly string[]): string[] {
	const names = [name];
	if (extname(name) || extensions.length === 0) {
		return names;
	}
	for (const ext of extensions) {
		const suffix = ext.startsWith(".") ? ext : `.${ext}`;
		names.push(`${name}${suffix}`);
	}
	return names;
}

export function findOnPath(name: string, pathEnv: string, options: FindOnPathOptions = {}): string | undefined {
	if (!name || !pathEnv) {
		return undefined;
	}
	const isPresent = options.isPresent ?? isUnixToolPresent;
	const names = namesOnPath(name, options.extensions ?? pathExtensions());
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) {
			continue;
		}
		for (const file of names) {
			const candidate = join(dir, file);
			if (isPresent(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

export function detectSedFlavor(bin: string): SedFlavor {
	const result = spawnSync(bin, ["--version"], {
		encoding: "utf8",
		timeout: 2000,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	if (/GNU sed/i.test(text)) {
		return "gnu";
	}
	if (result.error || result.status !== 0) {
		return "bsd";
	}
	return "unknown";
}

function defaultResolve(name: UnixToolId, pathEnv: string, options: ProbeUnixToolsOptions): string | undefined {
	return findOnPath(name, pathEnv, {
		extensions: options.extensions,
		isPresent: options.isPresent,
	});
}

export function probeUnixTools(options: ProbeUnixToolsOptions = {}): UnixToolReport {
	const pathEnv = unixKitPath(options.PATH);
	const resolve = options.resolve ?? ((name) => defaultResolve(name, pathEnv, options));
	const flavorOf = options.flavorOf ?? detectSedFlavor;
	const tools: UnixToolPresence[] = UNIX_TOOLS.map((id) => {
		const found = resolve(id);
		const optional = isOptionalUnixTool(id);
		if (!found) {
			return { id, present: false, optional };
		}
		const row: UnixToolPresence = { id, present: true, path: found, optional };
		if (id === "sed") {
			row.flavor = flavorOf(found);
		}
		return row;
	});
	return { tools };
}

export class UnixToolCache {
	private report: UnixToolReport | undefined;
	private readonly options: ProbeUnixToolsOptions;

	constructor(options: ProbeUnixToolsOptions = {}) {
		this.options = options;
	}

	get(): UnixToolReport {
		if (!this.report) {
			this.report = probeUnixTools(this.options);
		}
		return this.report;
	}
}

export function formatUnixToolsReport(report: UnixToolReport): string {
	const width = UNIX_TOOLS.reduce((max, id) => Math.max(max, id.length), 0);
	const lines = ["unix tools"];
	for (const tool of report.tools) {
		const name = tool.id.padEnd(width);
		if (!tool.present) {
			const skip = tool.optional ? "  skip" : "";
			lines.push(`${name}  missing${skip}`);
			continue;
		}
		const flavor = tool.flavor ? `  ${tool.flavor}` : "";
		lines.push(`${name}  ${tool.path}${flavor}`);
	}
	return lines.join("\n");
}
