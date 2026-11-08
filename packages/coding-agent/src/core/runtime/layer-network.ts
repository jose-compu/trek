/**
 * Layered API Workhorse otherwise answers like a coding chat with no web tools.
 * Bash can reach the network. Live facts go to Tooling when that runner is bound.
 */

import type { ResolvedRuntime } from "./resolve.ts";

export const LAYERING_NETWORK_SECTION = `## Network

This computer has internet. Use the bash tool (curl or wget) for live facts, weather, and URLs.
Do not say you have no internet, no weather data, or no external APIs.`;

export const LAYERING_DELEGATE_SECTION = `When Tooling is bound, send search, logs, fetch, weather, and live facts there:
{"action":"delegate","target":"tooling","reason":"live fetch"}
Do not escalate for a web lookup. Tooling is a runner, not a climb.`;

const LIVE_NETWORK =
	/\b(?:https?:\/\/|weather|forecast|temperature in|internet access|are you online|web search|search the web|browse the web|fetch (?:the |a )?url|latest news|stock price)\b/i;

export function needsLiveNetwork(task: string): boolean {
	return LIVE_NETWORK.test(task.trim());
}

export function layeringNetworkSection(toolingBound: boolean): string {
	if (!toolingBound) {
		return LAYERING_NETWORK_SECTION;
	}
	return `${LAYERING_NETWORK_SECTION}\n${LAYERING_DELEGATE_SECTION}`;
}

export function shouldInjectLayerNetwork(resolved: ResolvedRuntime): boolean {
	return resolved.effectiveMode !== "local";
}

export function shouldAutoDelegateLiveNetwork(task: string, resolved: ResolvedRuntime): boolean {
	if (resolved.layering === "single" || !resolved.roles.tooling) {
		return false;
	}
	return needsLiveNetwork(task);
}
