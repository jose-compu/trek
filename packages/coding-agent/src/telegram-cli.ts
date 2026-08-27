import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME } from "./config.ts";
import { parseTelegramConfigFile, type TelegramConfig } from "./core/telegram/config.ts";
import { AgentTelegramHost } from "./core/telegram/host.ts";
import { TelegramRuntime } from "./core/telegram/runtime.ts";
import type { TelegramApi, TelegramUpdate } from "./core/telegram/types.ts";
import { trekEnv } from "./utils/trek-env.ts";

function printTelegramHelp(): void {
	console.log(`${APP_NAME} telegram`);
	console.log("  Long-poll Telegram Bot API and drive AgentSession for allowlisted DMs.");
	console.log("  Token: TREK_TELEGRAM_BOT_TOKEN or ~/.trek/telegram.json");
	console.log("  Allowlists: allowed_user_ids / allowed_chat_ids (required, non-empty)");
}

export function defaultTelegramConfigPath(): string {
	return join(homedir(), ".trek", "telegram.json");
}

export function loadTelegramConfig(cwd: string, configPath = defaultTelegramConfigPath()): TelegramConfig {
	if (!existsSync(configPath)) {
		throw new Error(`Missing ${configPath}`);
	}
	const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
	return parseTelegramConfigFile(raw, cwd, trekEnv("TELEGRAM_BOT_TOKEN"));
}

export function createTelegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
	const base = `https://api.telegram.org/bot${token}`;
	return {
		async getUpdates(offset: number): Promise<TelegramUpdate[]> {
			const url = `${base}/getUpdates?timeout=20&offset=${offset}`;
			const response = await fetchImpl(url);
			const body = (await response.json()) as { ok?: boolean; result?: TelegramUpdate[] };
			if (!body.ok || !Array.isArray(body.result)) {
				throw new Error("Telegram getUpdates failed.");
			}
			return body.result;
		},
		async sendMessage(chatId: number, text: string): Promise<void> {
			const response = await fetchImpl(`${base}/sendMessage`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, text }),
			});
			if (!response.ok) {
				throw new Error(`Telegram sendMessage failed (${response.status}).`);
			}
		},
	};
}

export async function handleTelegramCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "telegram") {
		return false;
	}
	if (args.includes("--help") || args.includes("-h")) {
		printTelegramHelp();
		return true;
	}
	try {
		const config = loadTelegramConfig(process.cwd());
		const runtime = new TelegramRuntime(config, createTelegramApi(config.token), new AgentTelegramHost(config.cwd));
		console.log(`Telegram long-poll started for cwd=${config.cwd}`);
		for (;;) {
			await runtime.pollOnce();
		}
	} catch (err) {
		console.error(chalk.red(err instanceof Error ? err.message : String(err)));
		process.exitCode = 1;
		return true;
	}
}
