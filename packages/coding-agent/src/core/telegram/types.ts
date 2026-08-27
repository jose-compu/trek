export interface TelegramChat {
	id: number;
	type: string;
}

export interface TelegramMessage {
	message_id: number;
	chat: TelegramChat;
	from?: { id: number };
	text?: string;
	message_thread_id?: number;
	entities?: Array<{ type: string; offset: number; length: number }>;
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

export interface TelegramApi {
	getUpdates(offset: number): Promise<TelegramUpdate[]>;
	sendMessage(chatId: number, text: string): Promise<void>;
}

export interface TelegramSessionHost {
	prompt(sessionKey: string, text: string): Promise<string>;
	halt(sessionKey: string): void;
	reset(sessionKey: string): void;
	status(sessionKey: string): string;
	confirm(sessionKey: string): void;
}
