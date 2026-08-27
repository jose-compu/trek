export interface TelegramConfig {
	token: string;
	allowedUserIds: number[];
	allowedChatIds: number[];
	cwd: string;
}

export interface TelegramConfigFile {
	token?: string;
	allowed_user_ids?: number[];
	allowed_chat_ids?: number[];
	cwd?: string;
}

export function parseTelegramConfigFile(raw: unknown, cwd: string, envToken?: string): TelegramConfig {
	if (!raw || typeof raw !== "object") {
		throw new Error("telegram.json must be an object.");
	}
	const rec = raw as TelegramConfigFile;
	const token = envToken?.trim() || (typeof rec.token === "string" ? rec.token.trim() : "");
	if (!token) {
		throw new Error("Telegram bot token missing (TREK_TELEGRAM_BOT_TOKEN or telegram.json token).");
	}
	const allowedUserIds = Array.isArray(rec.allowed_user_ids)
		? rec.allowed_user_ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id))
		: [];
	const allowedChatIds = Array.isArray(rec.allowed_chat_ids)
		? rec.allowed_chat_ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id))
		: [];
	if (allowedUserIds.length === 0 && allowedChatIds.length === 0) {
		throw new Error("Telegram allowlist is empty (set allowed_user_ids or allowed_chat_ids).");
	}
	return {
		token,
		allowedUserIds,
		allowedChatIds,
		cwd: typeof rec.cwd === "string" && rec.cwd.trim() ? rec.cwd.trim() : cwd,
	};
}

export function isAllowedTelegramSender(config: TelegramConfig, userId: number | undefined, chatId: number): boolean {
	const userOk = userId !== undefined && config.allowedUserIds.includes(userId);
	const chatOk = config.allowedChatIds.includes(chatId);
	if (config.allowedUserIds.length > 0 && config.allowedChatIds.length > 0) {
		return userOk && chatOk;
	}
	if (config.allowedUserIds.length > 0) {
		return userOk;
	}
	return chatOk;
}
