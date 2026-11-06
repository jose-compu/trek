/** Wait this long, then leave a still-running command in the background. */
export const DEFAULT_BLOCK_UNTIL_MS = 8000;
/** @deprecated Use DEFAULT_BLOCK_UNTIL_MS */
export const DEFAULT_SERVER_BLOCK_UNTIL_MS = DEFAULT_BLOCK_UNTIL_MS;

const SERVER_COMMAND =
	/\b(?:python3?|py)\b[^;&|\n]*\b-m\s+http\.server\b|\bhttp\.server\b|\buvicorn\b|\bgunicorn\b|\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bnpm\s+(?:start|run\s+(?:dev|start|serve))\b|\byarn\s+(?:dev|start)\b|\bpnpm\s+(?:dev|start)\b|\bnpx\s+(?:serve|vite|http-server|live-server)\b|\bvite(?:\s|$)\b|\bnext\s+dev\b|\bphp\s+-S\b|\bnodemon\b|\blive-server\b|\bhttp-server\b|\bwrangler\s+dev\b/i;

const SERVER_READY =
	/serving http|listening on|running (?:on|at)|https?:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)|local:\s+http/i;

export function looksLikeServerCommand(command: string): boolean {
	return SERVER_COMMAND.test(command);
}

export function isServerReadyOutput(text: string): boolean {
	return SERVER_READY.test(text);
}

/** `block_until_ms: 0` waits for exit. Every other command defaults to 8s. */
export function resolveBlockUntilMs(_command: string, explicitMs?: number): number | undefined {
	if (explicitMs === 0) {
		return undefined;
	}
	if (explicitMs !== undefined && explicitMs > 0) {
		return explicitMs;
	}
	return DEFAULT_BLOCK_UNTIL_MS;
}

export function formatBackgroundedBash(pid: number, output: string): string {
	const head = `Started in background (pid ${pid}). The process keeps running.`;
	const body = output.trim();
	return body ? `${head}\n\n${body}` : `${head} No output yet.`;
}
