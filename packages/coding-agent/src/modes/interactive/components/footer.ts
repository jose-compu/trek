import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@trek/ai";
import { type Component, truncateToWidth, visibleWidth } from "@trek/tui";
import { VERSION } from "../../../config.ts";
import type { AgentSession } from "../../../core/agent-session.ts";
import { estimateTokens } from "../../../core/compaction/compaction.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";
import { formatFooterProductTag } from "./prompt-chrome.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function liveAssistantOutputTokens(message: AssistantMessage): number {
	if (message.usage.output > 0) return message.usage.output;
	return estimateTokens(message);
}

function liveAssistantCost(
	message: AssistantMessage,
	model: { cost?: { input: number; output: number; cacheRead: number; cacheWrite: number } } | undefined,
): number {
	if (message.usage.cost.total > 0) return message.usage.cost.total;
	if (!model?.cost) return 0;
	const output = liveAssistantOutputTokens(message);
	return (
		(model.cost.input * message.usage.input +
			model.cost.output * output +
			model.cost.cacheRead * message.usage.cacheRead +
			model.cost.cacheWrite * message.usage.cacheWrite) /
		1_000_000
	);
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private liveAssistant: AssistantMessage | undefined;
	private version: string;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider, version: string = VERSION) {
		this.session = session;
		this.footerData = footerData;
		this.version = version;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setLiveAssistant(message: AssistantMessage | undefined): void {
		this.liveAssistant = message;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		const entries = this.session.sessionManager.getEntries();

		for (const entry of entries) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
			}
		}

		const live = this.liveAssistant;
		if (live) {
			const alreadyCounted = entries.some(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "assistant" &&
					entry.message.timestamp === live.timestamp,
			);
			if (!alreadyCounted) {
				totalInput += live.usage.input;
				totalOutput += liveAssistantOutputTokens(live);
				totalCacheRead += live.usage.cacheRead;
				totalCacheWrite += live.usage.cacheWrite;
				totalCost += liveAssistantCost(live, state.model);
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		const dim = (text: string) => theme.fg("dim", text);
		const quiet = (text: string) => theme.fg("muted", text);
		const mark = (text: string) => theme.fg("accent", text);

		const cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		let pwd = `${dim(cwd)}${quiet(formatFooterProductTag(this.version))}`;

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} ${quiet("(")}${mark(branch)}${quiet(")")}`;
		}

		// Add session name if set
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			pwd = `${pwd}${dim(" • ")}${quiet(sessionName)}`;
		}

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`${dim("↑")}${quiet(formatTokens(totalInput))}`);
		if (totalOutput) statsParts.push(`${dim("↓")}${quiet(formatTokens(totalOutput))}`);
		if (totalCacheRead) statsParts.push(`${dim("R")}${quiet(formatTokens(totalCacheRead))}`);
		if (totalCacheWrite) statsParts.push(`${dim("W")}${quiet(formatTokens(totalCacheWrite))}`);

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			const costStr = quiet(`$${totalCost.toFixed(3)}`) + (usingSubscription ? dim(" (sub)") : "");
			statsParts.push(costStr);
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const percentLabel = contextPercent === "?" ? "?" : `${contextPercent}%`;
		const windowLabel = `/${formatTokens(contextWindow)}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", `${percentLabel}${windowLabel}`) + dim(autoIndicator);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", `${percentLabel}${windowLabel}`) + dim(autoIndicator);
		} else {
			contextPercentStr = quiet(percentLabel) + dim(windowLabel + autoIndicator);
		}
		statsParts.push(contextPercentStr);

		let statsLeft = statsParts.join(" ");

		// Active model on the right. In hierarchy mode, include the ladder role so
		// Decision → Workhorse → … → Frontier switches are visible in the footer.
		// Prefer hierarchyModelId so Decision (d1) shows even while Tooling is warmed.
		const hierarchyRole = this.session.hierarchyRole;
		const modelName = this.session.hierarchyModelId || state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Add thinking level indicator if model supports reasoning
		let rightSideWithoutProvider = hierarchyRole
			? `${quiet(hierarchyRole)}${dim(" · ")}${mark(modelName)}`
			: mark(modelName);
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			const level = thinkingLevel === "off" ? "thinking off" : thinkingLevel;
			rightSideWithoutProvider = `${rightSideWithoutProvider}${dim(" • ")}${dim(level)}`;
		}

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			const withProvider = `${dim(`(${state.model.provider})`)} ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(withProvider) <= width) {
				rightSide = withProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
				statsLine = statsLeft + padding + truncatedRight;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		const pwdLine = truncateToWidth(pwd, width, dim("..."));
		const lines = [pwdLine, statsLine];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
