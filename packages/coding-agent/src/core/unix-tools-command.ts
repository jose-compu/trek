/**
 * /tools unix — print the cached PATH probe. Never downloads a missing tool.
 */

import { formatUnixToolsReport, type UnixToolCache } from "./tools/unix-tools.ts";

export const UNIX_TOOLS_COMMAND_USAGE = "Usage: /tools unix";

export function runUnixToolsCommand(arg: string, cache: UnixToolCache): string {
	const parts = arg
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "unix")) {
		return formatUnixToolsReport(cache.get());
	}
	return UNIX_TOOLS_COMMAND_USAGE;
}
