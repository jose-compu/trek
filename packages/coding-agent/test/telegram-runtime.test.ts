/**
 * 0.6.0 Telegram runtime + DMs (#52, #53). Mocked Bot API.
 * Run: npx vitest run test/telegram-runtime.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { isAllowedTelegramSender, parseTelegramConfigFile } from "../src/core/telegram/config.ts";
import { TelegramRuntime } from "../src/core/telegram/runtime.ts";
import type { TelegramApi, TelegramSessionHost, TelegramUpdate } from "../src/core/telegram/types.ts";

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

function mockApi(): TelegramApi & { sent: Array<{ chatId: number; text: string }> } {
	const sent: Array<{ chatId: number; text: string }> = [];
	return {
		sent,
		getUpdates: async () => [],
		sendMessage: async (chatId, text) => {
			sent.push({ chatId, text });
		},
	};
}

function mockHost(): TelegramSessionHost & {
	prompts: string[];
	halted: string[];
	resets: string[];
	confirms: string[];
} {
	const prompts: string[] = [];
	const halted: string[] = [];
	const resets: string[] = [];
	const confirms: string[] = [];
	return {
		prompts,
		halted,
		resets,
		confirms,
		prompt: async (_key, text) => {
			prompts.push(text);
			return `reply:${text}`;
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
