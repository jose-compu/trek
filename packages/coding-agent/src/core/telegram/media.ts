import { join } from "node:path";

export const TELEGRAM_TEXT_LIMIT = 4096;
export const GROUP_TEXT_LIMIT = 1200;
export const DOCUMENT_THRESHOLD = 3500;

export interface OutboundReplyPlan {
	chunks: string[];
	document?: { filename: string; content: string };
}

export function looksLikeTraceDump(text: string): boolean {
	return (
		text.includes("trek:reflective_cycle") ||
		text.includes("lawsVerdict") ||
		(text.includes("observe:") && /c-\d{4}/.test(text))
	);
}

export function splitTelegramText(text: string, limit: number): string[] {
	if (text.length <= limit) {
		return [text.length > 0 ? text : ""];
	}
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > 0) {
		if (remaining.length <= limit) {
			chunks.push(remaining);
			break;
		}
		let cut = remaining.lastIndexOf("\n", limit);
		if (cut < Math.floor(limit / 2)) {
			cut = limit;
		}
		chunks.push(remaining.slice(0, cut));
		remaining = remaining.slice(cut).replace(/^\n/, "");
	}
	return chunks;
}

export function planOutboundReply(text: string, isGroup: boolean): OutboundReplyPlan {
	if (isGroup && looksLikeTraceDump(text)) {
		return { chunks: ["Trace omitted in group chat. Use a DM or trek trace show."] };
	}
	const limit = isGroup ? GROUP_TEXT_LIMIT : TELEGRAM_TEXT_LIMIT;
	if (text.length > DOCUMENT_THRESHOLD) {
		const previewLimit = Math.min(limit, 500);
		return {
			chunks: [`${text.slice(0, previewLimit)}\n\n(full reply attached as file)`],
			document: { filename: "trek-reply.txt", content: text },
		};
	}
	return { chunks: splitTelegramText(text, limit) };
}

export function telegramInboxDir(cwd: string): string {
	return join(cwd, ".trek", "telegram", "inbox");
}
