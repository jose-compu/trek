export type TelegramSafeMode = "off" | "owner_and_guest";

export interface TelegramConfig {
	token: string;
	allowedUserIds: number[];
	allowedChatIds: number[];
	ownerUserIds: number[];
	safeMode: TelegramSafeMode;
	guestRefusalNotice: "owner" | "off";
	cwd: string;
	botUsername?: string;
}

export interface TelegramConfigFile {
	token?: string;
	allowed_user_ids?: number[];
	allowed_chat_ids?: number[];
	owner_user_ids?: number[];
	safe_mode?: TelegramSafeMode;
	guest_refusal_notice?: "owner" | "off";
	cwd?: string;
	bot_username?: string;
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
	const ownerUserIds = integers(rec.owner_user_ids);
	const safeMode: TelegramSafeMode =
		rec.safe_mode === "owner_and_guest" || rec.safe_mode === "off"
			? rec.safe_mode
			: ownerUserIds.length > 0
				? "owner_and_guest"
				: "off";
	if (safeMode === "owner_and_guest" && ownerUserIds.length === 0) {
		throw new Error("Telegram safe mode needs owner_user_ids.");
	}
	const guestRefusalNotice = rec.guest_refusal_notice === "off" ? "off" : "owner";
	const botUsername =
		typeof rec.bot_username === "string" && rec.bot_username.trim()
			? rec.bot_username.trim().replace(/^@/, "")
			: undefined;
	return {
		token,
		allowedUserIds,
		allowedChatIds,
		ownerUserIds,
		safeMode,
		guestRefusalNotice,
		cwd: typeof rec.cwd === "string" && rec.cwd.trim() ? rec.cwd.trim() : cwd,
		botUsername,
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

function integers(value: unknown): number[] {
	return Array.isArray(value)
		? value.filter((id): id is number => typeof id === "number" && Number.isInteger(id))
		: [];
}

/** Allowlisted non-owners are guests when safe mode is on. Strangers are not classified here. */
export function telegramActor(config: TelegramConfig, userId: number | undefined): "owner" | "guest" {
	if (config.safeMode === "off") return "owner";
	if (userId !== undefined && config.ownerUserIds.includes(userId)) return "owner";
	return "guest";
}
