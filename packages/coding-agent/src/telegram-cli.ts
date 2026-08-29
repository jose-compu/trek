import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { APP_NAME } from "./config.ts";
import { parseTelegramConfigFile, type TelegramConfig } from "./core/telegram/config.ts";
import { AgentTelegramHost } from "./core/telegram/host.ts";
import { TelegramRuntime } from "./core/telegram/runtime.ts";
import type { TelegramApi, TelegramUpdate } from "./core/telegram/types.ts";
import { trekEnv } from "./utils/trek-env.ts";

function printTelegramHelp(): void {
	console.log(`${APP_NAME} telegram`);
	console.log("  Long-poll Telegram Bot API and drive AgentSession (DMs and groups).");
	console.log("  Token: TREK_TELEGRAM_BOT_TOKEN or ~/.trek/telegram.json");
	console.log("  Allowlists: allowed_user_ids / allowed_chat_ids (required, non-empty).");
	console.log("  Groups: reply only on /command or @bot mention; sessions isolated per chat/topic.");
	console.log("  Safety: /stop HALTs; gated tools need /confirm; traces are omitted in groups.");
	console.log("  Photos/documents stage to cwd/.trek/telegram/inbox/. Stickers/voice are unsupported.");
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
		async sendDocument(chatId: number, filename: string, content: string): Promise<void> {
			const form = new FormData();
			form.append("chat_id", String(chatId));
			form.append("document", new Blob([content], { type: "text/plain" }), filename);
			const response = await fetchImpl(`${base}/sendDocument`, { method: "POST", body: form });
			if (!response.ok) {
				throw new Error(`Telegram sendDocument failed (${response.status}).`);
			}
		},
		async downloadFile(fileId: string, destPath: string): Promise<void> {
			const metaResponse = await fetchImpl(`${base}/getFile?file_id=${encodeURIComponent(fileId)}`);
			const meta = (await metaResponse.json()) as { ok?: boolean; result?: { file_path?: string } };
			if (!meta.ok || !meta.result?.file_path) {
				throw new Error("Telegram getFile failed.");
			}
			const fileResponse = await fetchImpl(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
			if (!fileResponse.ok) {
				throw new Error(`Telegram file download failed (${fileResponse.status}).`);
			}
			mkdirSync(dirname(destPath), { recursive: true });
			writeFileSync(destPath, Buffer.from(await fileResponse.arrayBuffer()));
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
