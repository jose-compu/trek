export interface TelegramChat {
	id: number;
	type: string;
}

export interface TelegramPhotoSize {
	file_id: string;
	width: number;
	height: number;
}

export interface TelegramDocument {
	file_id: string;
	file_name?: string;
	mime_type?: string;
}

export interface TelegramMessage {
	message_id: number;
	chat: TelegramChat;
	from?: { id: number };
	text?: string;
	caption?: string;
	message_thread_id?: number;
	entities?: Array<{ type: string; offset: number; length: number }>;
	caption_entities?: Array<{ type: string; offset: number; length: number }>;
	photo?: TelegramPhotoSize[];
	document?: TelegramDocument;
	sticker?: { file_id: string };
	voice?: { file_id: string };
	audio?: { file_id: string };
	video_note?: { file_id: string };
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

export interface TelegramPromptAttachment {
	kind: "image" | "file";
	path: string;
	mimeType?: string;
}

export interface TelegramApi {
	getUpdates(offset: number): Promise<TelegramUpdate[]>;
	sendMessage(chatId: number, text: string): Promise<void>;
	sendDocument(chatId: number, filename: string, content: string): Promise<void>;
	downloadFile(fileId: string, destPath: string): Promise<void>;
}

export interface TelegramSessionHost {
	prompt(sessionKey: string, text: string, attachments?: TelegramPromptAttachment[]): Promise<string>;
	halt(sessionKey: string): void;
	reset(sessionKey: string): void;
	status(sessionKey: string): string;
	confirm(sessionKey: string): void;
}
