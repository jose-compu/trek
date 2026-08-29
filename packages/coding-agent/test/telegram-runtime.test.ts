/**
 * 0.6.0 Telegram runtime + DMs + media (#52, #53, #56). Mocked Bot API.
 * Run: npx vitest run test/telegram-runtime.test.ts --reporter=verbose
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedTelegramSender, parseTelegramConfigFile } from "../src/core/telegram/config.ts";
import {
	DOCUMENT_THRESHOLD,
	GROUP_TEXT_LIMIT,
	looksLikeTraceDump,
	planOutboundReply,
	splitTelegramText,
	telegramInboxDir,
} from "../src/core/telegram/media.ts";
import { TelegramRuntime } from "../src/core/telegram/runtime.ts";
import type {
	TelegramApi,
	TelegramPromptAttachment,
	TelegramSessionHost,
	TelegramUpdate,
} from "../src/core/telegram/types.ts";

function dm(text: string, chatId = 7, userId = 7, updateId = 1): TelegramUpdate {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			chat: { id: chatId, type: "private" },
			from: { id: userId },
			text,
		},
	};
}

function mockApi(): TelegramApi & {
	sent: Array<{ chatId: number; text: string }>;
	documents: Array<{ chatId: number; filename: string; content: string }>;
	downloads: Array<{ fileId: string; destPath: string }>;
} {
	const sent: Array<{ chatId: number; text: string }> = [];
	const documents: Array<{ chatId: number; filename: string; content: string }> = [];
	const downloads: Array<{ fileId: string; destPath: string }> = [];
	return {
		sent,
		documents,
		downloads,
		getUpdates: async () => [],
		sendMessage: async (chatId, text) => {
			sent.push({ chatId, text });
		},
		sendDocument: async (chatId, filename, content) => {
			documents.push({ chatId, filename, content });
		},
		downloadFile: async (fileId, destPath) => {
			mkdirSync(dirname(destPath), { recursive: true });
			writeFileSync(destPath, `file:${fileId}`);
			downloads.push({ fileId, destPath });
		},
	};
}

function mockHost(reply?: (text: string) => string): TelegramSessionHost & {
	prompts: string[];
	attachments: TelegramPromptAttachment[][];
	halted: string[];
	resets: string[];
	confirms: string[];
} {
	const prompts: string[] = [];
	const attachments: TelegramPromptAttachment[][] = [];
	const halted: string[] = [];
	const resets: string[] = [];
	const confirms: string[] = [];
	return {
		prompts,
		attachments,
		halted,
		resets,
		confirms,
		prompt: async (_key, text, atts) => {
			prompts.push(text);
			attachments.push(atts ?? []);
			return (reply ?? ((value) => `reply:${value}`))(text);
		},
		halt: (key) => {
			halted.push(key);
		},
		reset: (key) => {
			resets.push(key);
		},
		status: (key) => `status:${key}`,
		confirm: (key) => {
			confirms.push(key);
		},
	};
}

const config = parseTelegramConfigFile({ token: "tok", allowed_user_ids: [7], allowed_chat_ids: [7] }, "/tmp/trek");

describe("telegram config", () => {
	it("refuses an empty allowlist", () => {
		expect(() => parseTelegramConfigFile({ token: "tok" }, "/tmp")).toThrow(/allowlist is empty/);
	});

	it("accepts env token when file has none", () => {
		const parsed = parseTelegramConfigFile({ allowed_user_ids: [1] }, "/cwd", "env-token");
		expect(parsed.token).toBe("env-token");
		expect(parsed.cwd).toBe("/cwd");
	});

	it("allows user-id allowlist", () => {
		const cfg = parseTelegramConfigFile({ token: "t", allowed_user_ids: [7] }, "/tmp");
		expect(isAllowedTelegramSender(cfg, 7, 99)).toBe(true);
		expect(isAllowedTelegramSender(cfg, 8, 99)).toBe(false);
	});
});

describe("telegram DM runtime", () => {
	it("ignores unauthorized senders and group chats", async () => {
		const api = mockApi();
		const host = mockHost();
		const runtime = new TelegramRuntime(config, api, host);
		await runtime.handleUpdate(dm("hello", 7, 8));
		await runtime.handleUpdate({
			update_id: 2,
			message: { message_id: 2, chat: { id: 7, type: "group" }, from: { id: 7 }, text: "hello" },
		});
		expect(api.sent).toEqual([]);
		expect(host.prompts).toEqual([]);
	});

	it("routes /help, /new, /status, /stop, and prompts", async () => {
		const api = mockApi();
		const host = mockHost();
		const runtime = new TelegramRuntime(config, api, host);
		await runtime.handleUpdate(dm("/help", 7, 7, 1));
		await runtime.handleUpdate(dm("/new", 7, 7, 2));
		await runtime.handleUpdate(dm("/status", 7, 7, 3));
		await runtime.handleUpdate(dm("/stop", 7, 7, 4));
		await runtime.handleUpdate(dm("/confirm", 7, 7, 5));
		await runtime.handleUpdate(dm("hello agent", 7, 7, 6));
		expect(api.sent.map((s) => s.text)).toEqual([
			expect.stringContaining("/help"),
			"New session started.",
			"status:dm-7",
			"HALT.",
			"Destructive ops confirmed for this session.",
			"reply:hello agent",
		]);
		expect(host.resets).toEqual(["dm-7"]);
		expect(host.halted).toEqual(["dm-7"]);
		expect(host.confirms).toEqual(["dm-7"]);
		expect(host.prompts).toEqual(["hello agent"]);
	});
});

describe("telegram groups and isolation", () => {
	it("ignores unaddressed group chatter and accepts commands/mentions", async () => {
		const api = mockApi();
		const host = mockHost();
		const cfg = parseTelegramConfigFile({ token: "tok", allowed_user_ids: [7], bot_username: "trekbot" }, "/tmp");
		const runtime = new TelegramRuntime(cfg, api, host);
		await runtime.handleUpdate({
			update_id: 1,
			message: { message_id: 1, chat: { id: 99, type: "group" }, from: { id: 7 }, text: "hello" },
		});
		expect(host.prompts).toEqual([]);
		await runtime.handleUpdate({
			update_id: 2,
			message: {
				message_id: 2,
				chat: { id: 99, type: "supergroup" },
				from: { id: 7 },
				text: "/status@trekbot",
			},
		});
		expect(api.sent.at(-1)?.text).toBe("status:grp-99");
		await runtime.handleUpdate({
			update_id: 3,
			message: {
				message_id: 3,
				chat: { id: 99, type: "group" },
				from: { id: 7 },
				text: "@trekbot do the thing",
			},
		});
		expect(host.prompts).toEqual(["do the thing"]);
		expect(host.prompts).not.toContain("hello");
	});

	it("keeps DM sessions isolated per chat id", async () => {
		const api = mockApi();
		const host = mockHost();
		const cfg = parseTelegramConfigFile({ token: "tok", allowed_user_ids: [7] }, "/tmp");
		const runtime = new TelegramRuntime(cfg, api, host);
		await runtime.handleUpdate(dm("one", 7, 7, 1));
		await runtime.handleUpdate(dm("two", 8, 7, 2));
		expect(host.prompts).toEqual(["one", "two"]);
		expect(runtime.sessionKey(7)).toBe("dm-7");
		expect(runtime.sessionKey(8)).toBe("dm-8");
	});
});

describe("telegram media", () => {
	it("plans split chunks, file send, and group trace omission", () => {
		expect(splitTelegramText("ab\ncd", 3)).toEqual(["ab", "cd"]);
		expect(looksLikeTraceDump('{"type":"trek:reflective_cycle"}')).toBe(true);
		const long = "x".repeat(DOCUMENT_THRESHOLD + 1);
		const dmPlan = planOutboundReply(long, false);
		expect(dmPlan.document?.filename).toBe("trek-reply.txt");
		expect(dmPlan.chunks[0]).toContain("(full reply attached as file)");
		const groupTrace = planOutboundReply("observe: c-0001\nlawsVerdict: halt", true);
		expect(groupTrace.document).toBeUndefined();
		expect(groupTrace.chunks[0]).toMatch(/Trace omitted/);
		const groupSplit = planOutboundReply("y".repeat(GROUP_TEXT_LIMIT + 50), true);
		expect(groupSplit.document).toBeUndefined();
		expect(groupSplit.chunks.length).toBeGreaterThan(1);
	});

	it("stages inbound photos and documents, acks unsupported media", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-tg-"));
		const cfg = parseTelegramConfigFile({ token: "tok", allowed_user_ids: [7] }, cwd);
		const api = mockApi();
		const host = mockHost();
		const runtime = new TelegramRuntime(cfg, api, host);
		await runtime.handleUpdate({
			update_id: 1,
			message: {
				message_id: 1,
				chat: { id: 7, type: "private" },
				from: { id: 7 },
				caption: "look",
				photo: [
					{ file_id: "small", width: 10, height: 10 },
					{ file_id: "big", width: 800, height: 600 },
				],
			},
		});
		expect(host.prompts).toEqual(["look"]);
		expect(host.attachments[0]).toEqual([
			{ kind: "image", path: join(telegramInboxDir(cwd), "1.jpg"), mimeType: "image/jpeg" },
		]);
		expect(api.downloads[0]?.fileId).toBe("big");
		await runtime.handleUpdate({
			update_id: 2,
			message: {
				message_id: 2,
				chat: { id: 7, type: "private" },
				from: { id: 7 },
				caption: "patch",
				document: { file_id: "doc1", file_name: "../secret diff.txt", mime_type: "text/plain" },
			},
		});
		expect(host.prompts[1]).toBe("patch");
		expect(host.attachments[1]?.[0]).toEqual({
			kind: "file",
			path: join(telegramInboxDir(cwd), "secret_diff.txt"),
			mimeType: "text/plain",
		});
		await runtime.handleUpdate({
			update_id: 3,
			message: {
				message_id: 3,
				chat: { id: 7, type: "private" },
				from: { id: 7 },
				sticker: { file_id: "st" },
			},
		});
		await runtime.handleUpdate({
			update_id: 4,
			message: {
				message_id: 4,
				chat: { id: 7, type: "private" },
				from: { id: 7 },
				voice: { file_id: "vo" },
			},
		});
		expect(api.sent.filter((s) => s.text.includes("Unsupported")).length).toBe(2);
		expect(host.prompts.length).toBe(2);
	});

	it("splits long outbound replies and omits traces in groups", async () => {
		const api = mockApi();
		const host = mockHost(() => `${"d".repeat(DOCUMENT_THRESHOLD + 10)}\nend`);
		const runtime = new TelegramRuntime(config, api, host);
		await runtime.handleUpdate(dm("long please", 7, 7, 1));
		expect(api.sent[0]?.text).toContain("(full reply attached as file)");
		expect(api.documents).toEqual([expect.objectContaining({ chatId: 7, filename: "trek-reply.txt" })]);
		const groupApi = mockApi();
		const groupHost = mockHost(() => '{"type":"trek:reflective_cycle","cycleId":"c-0001"}');
		const groupCfg = parseTelegramConfigFile(
			{ token: "tok", allowed_user_ids: [7], bot_username: "trekbot" },
			"/tmp",
		);
		const groupRuntime = new TelegramRuntime(groupCfg, groupApi, groupHost);
		await groupRuntime.handleUpdate({
			update_id: 2,
			message: {
				message_id: 2,
				chat: { id: 99, type: "group" },
				from: { id: 7 },
				text: "@trekbot dump trace",
			},
		});
		expect(groupApi.sent.map((s) => s.text)).toEqual(["Trace omitted in group chat. Use a DM or trek trace show."]);
		expect(groupApi.documents).toEqual([]);
	});
});
