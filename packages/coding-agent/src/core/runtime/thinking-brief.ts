/**
 * /thinking briefly|deep|off. Compact thinking briefly card.
 * #108 128-token floor remains on tool turns.
 */

import type { ThinkingLevel } from "@trek/agent-core";
import type { RoleThinking } from "./types.ts";

export const THINKING_COMMAND_USAGE = "Usage: /thinking briefly|deep|off";

export const BRIEF_THINKING_VIEWPORT_LINES = 2;

export function parseThinkingCommand(arg: string): { pin: RoleThinking } | { error: string } | { status: true } {
	const trimmed = arg.trim().toLowerCase();
	if (!trimmed) {
		return { status: true };
	}
	if (trimmed === "briefly" || trimmed === "brief") {
		return { pin: "brief" };
	}
	if (trimmed === "deep") {
		return { pin: "deep" };
	}
	if (trimmed === "off") {
		return { pin: "off" };
	}
	return { error: THINKING_COMMAND_USAGE };
}

export function thinkingLevelForPin(pin: RoleThinking): ThinkingLevel {
	if (pin === "off") {
		return "off";
	}
	if (pin === "brief") {
		return "minimal";
	}
	return "high";
}

export function thinkingCardTitle(pin: RoleThinking | undefined): string {
	return pin === "brief" ? "thinking briefly" : "thinking";
}

export function thinkingCardViewport(pin: RoleThinking | undefined): number {
	return pin === "brief" ? BRIEF_THINKING_VIEWPORT_LINES : 3;
}

/** LayerDecision.thinking brief wins over the session pin and the role default. */
export function effectiveThinkingPin(
	sessionPin: RoleThinking | undefined,
	decisionThinking: RoleThinking | undefined,
	roleThinking: RoleThinking | undefined,
): RoleThinking {
	if (decisionThinking === "brief") {
		return "brief";
	}
	if (sessionPin) {
		return sessionPin;
	}
	if (decisionThinking) {
		return decisionThinking;
	}
	return roleThinking ?? "off";
}

export function formatThinkingPin(pin: RoleThinking | undefined): string {
	if (pin === "brief") {
		return "thinking briefly";
	}
	if (pin === "deep") {
		return "thinking deep";
	}
	if (pin === "off") {
		return "thinking off";
	}
	return "thinking unset";
}

const sessionPins = new Map<string, RoleThinking>();

export function setSessionThinkingPin(sessionId: string | undefined, pin: RoleThinking | undefined): void {
	if (!sessionId) {
		return;
	}
	if (!pin) {
		sessionPins.delete(sessionId);
		return;
	}
	sessionPins.set(sessionId, pin);
}

export function sessionThinkingPin(sessionId: string | undefined): RoleThinking | undefined {
	if (!sessionId) {
		return undefined;
	}
	return sessionPins.get(sessionId);
}

/** `/thinking deep` restores the 0.17 card and skips the #108 128-token floor. */
export function skipShortTraceCap(pin: RoleThinking | undefined): boolean {
	return pin === "deep";
}

export function runThinkingCommand(
	current: RoleThinking | undefined,
	arg: string,
): { pin?: RoleThinking; message: string } {
	const parsed = parseThinkingCommand(arg);
	if ("error" in parsed) {
		return { pin: current, message: parsed.error };
	}
	if ("status" in parsed) {
		return { pin: current, message: formatThinkingPin(current) };
	}
	return {
		pin: parsed.pin,
		message: formatThinkingPin(parsed.pin),
	};
}
