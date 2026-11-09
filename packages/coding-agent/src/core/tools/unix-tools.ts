/**
 * PATH probe for the 0.19 Unix kit. Cache once. Never download a missing tool.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

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

export interface ProbeUnixToolsOptions {
	PATH?: string;
	resolve?: (name: UnixToolId) => string | undefined;
	flavorOf?: (bin: string) => SedFlavor;
}

const OPTIONAL = new Set<string>(OPTIONAL_UNIX_TOOLS);

export function isOptionalUnixTool(id: UnixToolId): boolean {
	return OPTIONAL.has(id);
}

export function findOnPath(name: string, pathEnv: string): string | undefined {
	if (!name || !pathEnv) {
		return undefined;
	}
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) {
			continue;
		}
		const candidate = join(dir, name);
		if (existsSync(candidate)) {
			return candidate;
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

function defaultResolve(name: UnixToolId, pathEnv: string): string | undefined {
	return findOnPath(name, pathEnv);
}

export function probeUnixTools(options: ProbeUnixToolsOptions = {}): UnixToolReport {
	const pathEnv = options.PATH ?? process.env.PATH ?? "";
	const resolve = options.resolve ?? ((name) => defaultResolve(name, pathEnv));
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
