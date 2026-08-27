import { isAllowedTelegramSender, type TelegramConfig } from "./config.ts";
import type { TelegramApi, TelegramSessionHost, TelegramUpdate } from "./types.ts";

const HELP = ["/start", "/help", "/new", "/status", "/stop"].join("  ");

export class TelegramRuntime {
	private offset = 0;
	private readonly sessions = new Set<string>();
	private readonly config: TelegramConfig;
	private readonly api: TelegramApi;
	private readonly host: TelegramSessionHost;

	constructor(config: TelegramConfig, api: TelegramApi, host: TelegramSessionHost) {
		this.config = config;
		this.api = api;
		this.host = host;
	}

	sessionKey(chatId: number): string {
		return `dm-${chatId}`;
	}

	async handleUpdate(update: TelegramUpdate): Promise<void> {
		this.offset = Math.max(this.offset, update.update_id + 1);
		const message = update.message;
		if (!message?.text || message.chat.type !== "private") {
			return;
		}
		const chatId = message.chat.id;
		const userId = message.from?.id;
		if (!isAllowedTelegramSender(this.config, userId, chatId)) {
			return;
		}
		const key = this.sessionKey(chatId);
		this.sessions.add(key);
		const text = message.text.trim();
		if (text === "/start" || text === "/help") {
			await this.api.sendMessage(chatId, `Trek remote agent. Commands: ${HELP}`);
			return;
		}
		if (text === "/new") {
			this.host.reset(key);
			await this.api.sendMessage(chatId, "New session started.");
			return;
		}
		if (text === "/status") {
			await this.api.sendMessage(chatId, this.host.status(key));
			return;
		}
		if (text === "/stop") {
			this.host.halt(key);
			await this.api.sendMessage(chatId, "HALT.");
			return;
		}
		const reply = await this.host.prompt(key, text);
		await this.api.sendMessage(chatId, reply.slice(0, 4000));
	}

	async pollOnce(): Promise<number> {
		const updates = await this.api.getUpdates(this.offset);
		for (const update of updates) {
			await this.handleUpdate(update);
		}
		return updates.length;
	}
}
