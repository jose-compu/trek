/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `trek -p "prompt"` - text output
 * - `trek --mode json "prompt"` - JSON event stream
 */

import type { AssistantMessage, ImageContent, ToolResultMessage } from "@trek/ai";
import type { AgentSessionEvent } from "../core/agent-session.ts";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, writeRawStdout } from "../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Log tool calls, results, and lifecycle to stderr while running */
	verbose?: boolean;
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
function logVerboseEvent(event: AgentSessionEvent): void {
	switch (event.type) {
		case "agent_start":
			console.error("[trek] agent started");
			break;
		case "prompt_meta":
			console.error(`[trek] prompt ${event.promptId}`);
			break;
		case "tool_execution_start":
			console.error(`[trek] tool → ${event.toolName} ${JSON.stringify(event.args)}`);
			break;
		case "tool_execution_end": {
			const text =
				event.result?.content
					?.filter((c: { type: string }) => c.type === "text")
					.map((c: { text?: string }) => c.text ?? "")
					.join("\n") ?? "";
			const prefix = event.isError ? "[trek] tool ✗" : "[trek] tool ✓";
			console.error(`${prefix} ${event.toolName}: ${text || "(no text output)"}`);
			break;
		}
		case "message_end":
			if (event.message.role === "assistant") {
				const assistant = event.message as AssistantMessage;
				const toolCalls = assistant.content.filter((c) => c.type === "toolCall");
				if (toolCalls.length > 0) {
					console.error(`[trek] assistant requested ${toolCalls.length} tool call(s)`);
				}
				const textParts = assistant.content
					.filter((c) => c.type === "text")
					.map((c) => (c.type === "text" ? c.text : ""))
					.join("");
				if (textParts.trim()) {
					console.error(`[trek] assistant: ${textParts.slice(0, 200)}${textParts.length > 200 ? "…" : ""}`);
				}
			}
			break;
		case "agent_end":
			console.error(`[trek] agent finished (${event.messages.length} messages)`);
			break;
		default:
			break;
	}
}

function getToolResultText(message: ToolResultMessage): string {
	return message.content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages, verbose = false } = options;
	let exitCode = 0;
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let disposed = false;
	const signalCleanupHandlers: Array<() => void> = [];

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void disposeRuntime().finally(() => {
					process.exit(signal === "SIGHUP" ? 129 : 143);
				});
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	registerSignalHandlers();

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigateOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navigateOptions?.summarize,
						customInstructions: navigateOptions?.customInstructions,
						replaceInstructions: navigateOptions?.replaceInstructions,
						label: navigateOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, switchOptions) => {
					return runtimeHost.switchSession(sessionPath, switchOptions);
				},
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				console.error(`Extension error (${err.extensionPath}): ${err.error}`);
			},
		});

		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			if (verbose) {
				logVerboseEvent(event);
			}
			if (mode === "json") {
				writeRawStdout(`${JSON.stringify(event)}\n`);
			}
		});
	};

	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) {
				writeRawStdout(`${JSON.stringify(header)}\n`);
			}
		}

		await rebindSession();

		if (verbose && initialMessage) {
			console.error(`[trek] prompt: ${initialMessage.slice(0, 120)}${initialMessage.length > 120 ? "…" : ""}`);
		}

		if (initialMessage) {
			await session.prompt(initialMessage, { images: initialImages });
		}

		for (const message of messages) {
			await session.prompt(message);
		}

		if (mode === "text") {
			const state = session.state;
			const lastMessage = state.messages[state.messages.length - 1];
			let printed = false;

			if (lastMessage?.role === "assistant") {
				const assistantMsg = lastMessage as AssistantMessage;
				if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
					console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
					exitCode = 1;
				} else {
					for (const content of assistantMsg.content) {
						if (content.type === "text" && content.text.trim()) {
							writeRawStdout(`${content.text}\n`);
							printed = true;
						}
					}
				}
			}

			// When the turn ends on tool results (e.g. safety block), surface them on stderr.
			if (!printed) {
				const toolResults = state.messages.filter((m): m is ToolResultMessage => m.role === "toolResult");
				const recent = toolResults.slice(-3);
				for (const tr of recent) {
					const text = getToolResultText(tr);
					if (text.trim()) {
						console.error(`[trek] ${tr.toolName}: ${text}`);
					}
				}
			}
		}

		return exitCode;
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		await disposeRuntime();
		await flushRawStdout();
	}
}
