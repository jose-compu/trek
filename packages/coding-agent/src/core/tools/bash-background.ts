/** Wait this long, then leave a still-running command in the background. */
export const DEFAULT_BLOCK_UNTIL_MS = 8000;
/** Python 3.14 http.server prints nothing until a request. Detach sooner. */
export const SERVER_BLOCK_UNTIL_MS = 1500;
/** @deprecated Use SERVER_BLOCK_UNTIL_MS */
export const DEFAULT_SERVER_BLOCK_UNTIL_MS = SERVER_BLOCK_UNTIL_MS;
/** Models copy the 8000ms detach default into `timeout` (seconds). Cap kills. */
export const MAX_TIMEOUT_SECONDS = 120;
/** Wait/poll commands (`sleep`, `gh … --watch`) may block this long. */
export const MAX_WAIT_TIMEOUT_SECONDS = 300;

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
 * Sleep, `gh --watch`, and poll loops must wait for exit.
 * Detaching them after 8s makes the model think CI never finished.
 */
export function looksLikeWaitCommand(command: string): boolean {
	if (looksLikeServerCommand(command)) {
		return false;
	}
	if (/\bsleep\s+\d/.test(command) || /\btime\.sleep\s*\(/.test(command)) {
		return true;
	}
	if (/\bgh\b/.test(command)) {
		if (/\brun\s+watch\b/.test(command)) {
			return true;
		}
		if (/\s--watch\b/.test(command) && /\b(?:pr\s+checks|run\s+view)\b/.test(command)) {
			return true;
		}
	}
	return /\b(?:until|while)\b/.test(command) && /\bsleep\b/.test(command);
}

/**
 * `timeout` kills. Server-like commands ignore it so `timeout: 8000` cannot stall the turn.
 * Wait/poll commands default to 300s. Other commands cap at 120s.
 */
export function resolveTimeoutSeconds(command: string, timeout?: number): number | undefined {
	if (looksLikeServerCommand(command)) {
		return undefined;
	}
	if (looksLikeWaitCommand(command)) {
		const raw = timeout !== undefined && timeout > 0 ? timeout : MAX_WAIT_TIMEOUT_SECONDS;
		return Math.min(raw, MAX_WAIT_TIMEOUT_SECONDS);
	}
	if (timeout === undefined || timeout <= 0) {
		return undefined;
	}
	return Math.min(timeout, MAX_TIMEOUT_SECONDS);
}

/**
 * `block_until_ms: 0` waits for exit, except on server-like commands.
 * Wait/poll commands and an explicit `timeout` also wait for exit (timeout kills).
 * Models pass 0 or a huge wait with `timeout: 8000` and leave Working... spinning.
 */
export function resolveBlockUntilMs(command: string, explicitMs?: number, timeoutSeconds?: number): number | undefined {
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
	if (looksLikeWaitCommand(command)) {
		return undefined;
	}
	if (timeoutSeconds !== undefined && timeoutSeconds > 0) {
		return undefined;
	}
	return DEFAULT_BLOCK_UNTIL_MS;
}

export function formatBackgroundedBash(pid: number, output: string): string {
	const head = `Started in background (pid ${pid}). The process keeps running.`;
	const body = output.trim();
	return body ? `${head}\n\n${body}` : `${head} No output yet.`;
}
