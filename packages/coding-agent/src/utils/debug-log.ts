/**
 * Trek debug logging — verbose internal diagnostics gated by --debug or TREK_DEBUG.
 * Writes to a log file so stderr does not corrupt the interactive TUI.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDebugLogPath } from "../config.ts";
import { isTrekEnvTruthy } from "./trek-env.ts";

let debugEnabled = false;
let debugLogPathOverride: string | undefined;
let debugSessionStarted = false;

export function setDebugEnabled(enabled: boolean): void {
	debugEnabled = enabled;
	if (!enabled) {
		debugSessionStarted = false;
	}
}

export function setDebugLogPath(path: string | undefined): void {
	debugLogPathOverride = path;
}

export function isDebugEnabled(): boolean {
	return debugEnabled || isTrekEnvTruthy("DEBUG");
}

export function getActiveDebugLogPath(): string {
	return debugLogPathOverride ?? getDebugLogPath();
}

export function debugLog(component: string, message: string, data?: unknown): void {
	if (!isDebugEnabled()) return;
	const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : "";
	const line = `[${new Date().toISOString()}] [trek:debug:${component}] ${message}${suffix}\n`;
	const path = getActiveDebugLogPath();
	mkdirSync(dirname(path), { recursive: true });
	if (!debugSessionStarted) {
		debugSessionStarted = true;
		appendFileSync(path, `[${new Date().toISOString()}] [trek:debug:session] log file ${path}\n`);
	}
	appendFileSync(path, line);
}
