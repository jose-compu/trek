import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { isAllowedTelegramSender, type TelegramConfig } from "./config.ts";
import { planOutboundReply, telegramInboxDir } from "./media.ts";
import type {
	TelegramApi,
	TelegramMessage,
	TelegramPromptAttachment,
	TelegramSessionHost,
	TelegramUpdate,
} from "./types.ts";

const HELP = ["/start", "/help", "/new", "/status", "/stop", "/confirm"].join("  ");
const UNSUPPORTED = "Unsupported media (stickers/voice). Send text, a photo, or a document.";

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

function messageText(message: TelegramMessage): string {
	return (message.text ?? message.caption ?? "").trim();
}

function isUnsupportedMedia(message: TelegramMessage): boolean {
	return Boolean(message.sticker || message.voice || message.audio || message.video_note);
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
	const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
	return entities.some((entity) => entity.type === "mention");
}

function promptText(config: TelegramConfig, text: string): string {
	const username = config.botUsername;
	if (!username) {
		return text;
	}
	return text.replaceAll(`@${username}`, "").replace(/\s+/g, " ").trim();
}

function largestPhoto(message: TelegramMessage): { file_id: string } | undefined {
	const photos = message.photo;
	if (!photos || photos.length === 0) {
		return undefined;
	}
	return photos.reduce((best, size) => (size.width * size.height > best.width * best.height ? size : best));
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

	private async sendReply(chatId: number, chatType: string, text: string): Promise<void> {
		const plan = planOutboundReply(text, isGroupChat(chatType));
		for (const chunk of plan.chunks) {
			if (chunk.length > 0) {
				await this.api.sendMessage(chatId, chunk);
			}
		}
		if (plan.document) {
			await this.api.sendDocument(chatId, plan.document.filename, plan.document.content);
		}
	}

	private async stageAttachments(message: TelegramMessage): Promise<TelegramPromptAttachment[]> {
		const attachments: TelegramPromptAttachment[] = [];
		const inbox = telegramInboxDir(this.config.cwd);
		mkdirSync(inbox, { recursive: true });
		const photo = largestPhoto(message);
		if (photo) {
			const dest = join(inbox, `${message.message_id}.jpg`);
			await this.api.downloadFile(photo.file_id, dest);
			attachments.push({ kind: "image", path: dest, mimeType: "image/jpeg" });
		}
		if (message.document) {
			const raw = message.document.file_name ? basename(message.document.file_name) : "";
			const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
			const name = cleaned.length > 0 ? cleaned : `${message.message_id}.bin`;
			const dest = join(inbox, name);
			await this.api.downloadFile(message.document.file_id, dest);
			attachments.push({ kind: "file", path: dest, mimeType: message.document.mime_type });
		}
		return attachments;
	}

	async handleUpdate(update: TelegramUpdate): Promise<void> {
		this.offset = Math.max(this.offset, update.update_id + 1);
		const message = update.message;
		if (!message) {
			return;
		}
		const text = messageText(message);
		const hasMedia = Boolean(largestPhoto(message) || message.document);
		if (!text && !hasMedia && !isUnsupportedMedia(message)) {
			return;
		}
		if (!isAddressed(this.config, message, text)) {
			return;
		}
		const chatId = message.chat.id;
		const userId = message.from?.id;
		if (!isAllowedTelegramSender(this.config, userId, chatId)) {
			return;
		}
		if (isUnsupportedMedia(message)) {
			await this.api.sendMessage(chatId, UNSUPPORTED);
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
		const attachments = hasMedia ? await this.stageAttachments(message) : [];
		const prompt = promptText(this.config, text) || (hasMedia ? "See attached media." : "");
		if (!prompt && attachments.length === 0) {
			return;
		}
		const reply = await this.host.prompt(key, prompt, attachments);
		await this.sendReply(chatId, message.chat.type, reply);
	}

	async pollOnce(): Promise<number> {
		const updates = await this.api.getUpdates(this.offset);
		for (const update of updates) {
			await this.handleUpdate(update);
		}
		return updates.length;
	}
}
