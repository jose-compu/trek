/**
 * Batch mode: run prompts sequentially from a file or stdin.
 *
 * Used for:
 * - `trek --batch prompts.txt`
 * - `cat prompts.txt | trek --batch -`
 */

import type { AssistantMessage, ImageContent } from "@trek/ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, writeRawStdout } from "../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";

export interface BatchModeOptions {
	/** Output mode: "text" for final response only, "jsonl" for header + prompt_meta + events */
	output: "text" | "jsonl";
	prompts: string[];
	initialImages?: ImageContent[];
}

export async function runBatchMode(runtimeHost: AgentSessionRuntime, options: BatchModeOptions): Promise<number> {
	const { output, prompts, initialImages } = options;
	const jsonl = output === "jsonl";
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
			mode: jsonl ? "json" : "print",
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
			if (jsonl) {
				writeRawStdout(`${JSON.stringify(event)}\n`);
			}
		});
	};

	try {
		if (jsonl) {
			const header = session.sessionManager.getHeader();
			if (header) {
				writeRawStdout(`${JSON.stringify(header)}\n`);
			}
		}

		await rebindSession();

		for (let i = 0; i < prompts.length; i++) {
			const prompt = prompts[i];
			const images = i === 0 ? initialImages : undefined;
			await session.prompt(prompt, { images, source: "batch" });

			if (output === "text") {
				const state = session.state;
				const lastMessage = state.messages[state.messages.length - 1];
				if (lastMessage?.role === "assistant") {
					const assistantMsg = lastMessage as AssistantMessage;
					if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
						console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
						exitCode = 1;
					} else {
						for (const content of assistantMsg.content) {
							if (content.type === "text") {
								writeRawStdout(`${content.text}\n`);
							}
						}
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
