import type { AgentSession } from "../agent-session.ts";
import { createAgentSession } from "../sdk.ts";
import { SessionManager } from "../session-manager.ts";
import type { TelegramSessionHost } from "./types.ts";

function lastAssistantText(session: AgentSession): string {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const message = session.messages[i];
		if (!message || message.role !== "assistant") {
			continue;
		}
		const content = message.content;
		if (typeof content === "string") {
			return content;
		}
		if (Array.isArray(content)) {
			return content
				.filter(
					(part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string",
				)
				.map((part) => part.text)
				.join("\n")
				.trim();
		}
	}
	return "(no reply)";
}

export class AgentTelegramHost implements TelegramSessionHost {
	private readonly sessions = new Map<string, AgentSession>();
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	private async get(sessionKey: string): Promise<AgentSession> {
		const existing = this.sessions.get(sessionKey);
		if (existing) {
			return existing;
		}
		const created = await createAgentSession({
			cwd: this.cwd,
			sessionManager: SessionManager.create(this.cwd, undefined, { id: sessionKey }),
		});
		this.sessions.set(sessionKey, created.session);
		return created.session;
	}

	async prompt(sessionKey: string, text: string): Promise<string> {
		const session = await this.get(sessionKey);
		if (session.isHalted()) {
			return "HALT is engaged. Send /new to resume.";
		}
		await session.prompt(text);
		return lastAssistantText(session) || "(no reply)";
	}

	halt(sessionKey: string): void {
		const session = this.sessions.get(sessionKey);
		session?.requestHalt();
	}

	reset(sessionKey: string): void {
		const session = this.sessions.get(sessionKey);
		session?.clearHalt();
		this.sessions.delete(sessionKey);
	}

	status(sessionKey: string): string {
		const session = this.sessions.get(sessionKey);
		if (!session) {
			return `session=${sessionKey} idle`;
		}
		return `session=${sessionKey} ${session.isHalted() ? "halted" : "running"}`;
	}
}
