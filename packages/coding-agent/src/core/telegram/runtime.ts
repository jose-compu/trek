import { isAllowedTelegramSender, type TelegramConfig } from "./config.ts";
import type { TelegramApi, TelegramMessage, TelegramSessionHost, TelegramUpdate } from "./types.ts";

const HELP = ["/start", "/help", "/new", "/status", "/stop", "/confirm"].join("  ");

function isGroupChat(type: string): boolean {
	return type === "group" || type === "supergroup";
}

function firstToken(text: string): string {
	return text.trim().split(/\s+/, 1)[0] ?? "";
}

function commandName(text: string): string {
	const token = firstToken(text);
	if (!token.startsWith("/")) {
		return "";
	}
	return token.split("@", 1)[0] ?? token;
}

function isAddressed(config: TelegramConfig, message: TelegramMessage, text: string): boolean {
	if (!isGroupChat(message.chat.type)) {
		return true;
	}
	if (commandName(text).startsWith("/")) {
		return true;
	}
	const username = config.botUsername;
	if (!username) {
		return false;
	}
	if (text.includes(`@${username}`)) {
		return true;
	}
	return Boolean(message.entities?.some((entity) => entity.type === "mention"));
}

function promptText(config: TelegramConfig, text: string): string {
	const username = config.botUsername;
	if (!username) {
		return text;
	}
	return text.replaceAll(`@${username}`, "").replace(/\s+/g, " ").trim();
}

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

	sessionKey(chatId: number, threadId?: number, chatType = "private"): string {
		const prefix = isGroupChat(chatType) ? "grp" : "dm";
		if (threadId !== undefined) {
			return `${prefix}-${chatId}-t${threadId}`;
		}
		return `${prefix}-${chatId}`;
	}

	async handleUpdate(update: TelegramUpdate): Promise<void> {
		this.offset = Math.max(this.offset, update.update_id + 1);
		const message = update.message;
		if (!message?.text) {
			return;
		}
		const text = message.text.trim();
		if (!isAddressed(this.config, message, text)) {
			return;
		}
		const chatId = message.chat.id;
		const userId = message.from?.id;
		if (!isAllowedTelegramSender(this.config, userId, chatId)) {
			return;
		}
		const key = this.sessionKey(chatId, message.message_thread_id, message.chat.type);
		this.sessions.add(key);
		const command = commandName(text);
		if (command === "/start" || command === "/help") {
			await this.api.sendMessage(chatId, `Trek remote agent. Commands: ${HELP}`);
			return;
		}
		if (command === "/new") {
			this.host.reset(key);
			await this.api.sendMessage(chatId, "New session started.");
			return;
		}
		if (command === "/status") {
			await this.api.sendMessage(chatId, this.host.status(key));
			return;
		}
		if (command === "/stop") {
			this.host.halt(key);
			await this.api.sendMessage(chatId, "HALT.");
			return;
		}
		if (command === "/confirm") {
			this.host.confirm(key);
			await this.api.sendMessage(chatId, "Destructive ops confirmed for this session.");
			return;
		}
		const reply = await this.host.prompt(key, promptText(this.config, text));
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
