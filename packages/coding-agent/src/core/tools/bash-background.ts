/** Wait this long, then leave a still-running command in the background. */
export const DEFAULT_BLOCK_UNTIL_MS = 8000;
/** Python 3.14 http.server prints nothing until a request. Detach sooner. */
export const SERVER_BLOCK_UNTIL_MS = 1500;
/** @deprecated Use SERVER_BLOCK_UNTIL_MS */
export const DEFAULT_SERVER_BLOCK_UNTIL_MS = SERVER_BLOCK_UNTIL_MS;
/** Models copy the 8000ms detach default into `timeout` (seconds). Cap kills. */
export const MAX_TIMEOUT_SECONDS = 120;

const SERVER_COMMAND =
	/\b(?:python3?|py)\b[^;&|\n]*\b-m\s+http\.server\b|\bhttp\.server\b|\buvicorn\b|\bgunicorn\b|\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bnpm\s+(?:start|run\s+(?:dev|start|serve))\b|\byarn\s+(?:dev|start)\b|\bpnpm\s+(?:dev|start)\b|\bnpx\s+(?:serve|vite|http-server|live-server)\b|\bvite(?:\s|$)\b|\bnext\s+dev\b|\bphp\s+-S\b|\bnodemon\b|\blive-server\b|\bhttp-server\b|\bwrangler\s+dev\b/i;

const SERVER_READY =
	/serving http|listening on|running (?:on|at)|https?:\/\/(?:127\.0\.0\.1|\[::\]|\[::1\]|localhost)|local:\s+http|\bHTTP\/1\.[01]"?\s+\d{3}\b/i;

export function looksLikeServerCommand(command: string): boolean {
	return SERVER_COMMAND.test(command);
}

export function isServerReadyOutput(text: string): boolean {
	return SERVER_READY.test(text);
}

/**
 * `timeout` kills. Server-like commands ignore it so `timeout: 8000` cannot stall the turn.
 * Other commands cap at 120s.
 */
export function resolveTimeoutSeconds(command: string, timeout?: number): number | undefined {
	if (timeout === undefined || timeout <= 0) {
		return undefined;
	}
	if (looksLikeServerCommand(command)) {
		return undefined;
	}
	return Math.min(timeout, MAX_TIMEOUT_SECONDS);
}

/**
 * `block_until_ms: 0` waits for exit, except on server-like commands.
 * Models pass 0 or a huge wait with `timeout: 8000` and leave Working... spinning.
 */
export function resolveBlockUntilMs(command: string, explicitMs?: number): number | undefined {
	if (looksLikeServerCommand(command)) {
		if (explicitMs !== undefined && explicitMs > 0) {
			return Math.min(explicitMs, SERVER_BLOCK_UNTIL_MS);
		}
		return SERVER_BLOCK_UNTIL_MS;
	}
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
