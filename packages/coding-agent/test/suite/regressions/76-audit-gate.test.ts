/**
 * 0.7.0 Audit acceptance gate (#76). Faux LLM only.
 * Run: npx vitest run test/suite/regressions/76-audit-gate.test.ts --reporter=verbose
 */

import type { AgentTool } from "@trek/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@trek/ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AuditStepRecord,
	formatDeterminismWarning,
	isValidAuditStep,
	resolveReproducibility,
} from "../../../src/core/reproducibility/index.ts";
import { createHarness, type Harness } from "../harness.ts";

const echoTool: AgentTool = {
	name: "echo",
	label: "Echo",
	description: "Echo text back",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_toolCallId, params) => {
		const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
		return { content: [{ type: "text", text: `echo:${text}` }], details: { text } };
	},
};

function toolTurn(): ReturnType<typeof fauxAssistantMessage>[] {
	return [
		fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	];
}

describe("regression #76: 0.7.0 Audit acceptance", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("same seed + same faux LLM yields identical tool intent and valid audit JSON", async () => {
		const first = await createHarness({
			tools: [echoTool],
			settings: { reproducibility: { seed: 42 } },
		});
		const second = await createHarness({
			tools: [echoTool],
			settings: { reproducibility: { seed: 42 } },
		});
		harnesses.push(first, second);

		first.setResponses(toolTurn());
		second.setResponses(toolTurn());
		await first.session.prompt("start");
		await second.session.prompt("start");

		const firstCalls = first.session.messages
			.filter((message) => message.role === "assistant")
			.flatMap((message) => message.content.filter((part) => part.type === "toolCall"));
		const secondCalls = second.session.messages
			.filter((message) => message.role === "assistant")
			.flatMap((message) => message.content.filter((part) => part.type === "toolCall"));
		expect(firstCalls.map((call) => ({ name: call.name, arguments: call.arguments }))).toEqual(
			secondCalls.map((call) => ({ name: call.name, arguments: call.arguments })),
		);

		const firstSteps = first.sessionManager.getAuditSteps<AuditStepRecord>();
		const secondSteps = second.sessionManager.getAuditSteps<AuditStepRecord>();
		expect(firstSteps).toHaveLength(2);
		expect(secondSteps).toHaveLength(2);
		expect(firstSteps.every((step) => isValidAuditStep(step))).toBe(true);
		expect(secondSteps.every((step) => isValidAuditStep(step))).toBe(true);
		expect(firstSteps[0]?.toolsAvailableHash).toBe(secondSteps[0]?.toolsAvailableHash);
		expect(firstSteps[1]?.outputHash).toBe(secondSteps[1]?.outputHash);
		expect(first.session.getReproducibility().seed).toBe(42);
		expect(second.session.getReproducibility().seed).toBe(42);
	});

	it("copies system_fingerprint onto the audit record when the assistant reports one", async () => {
		const harness = await createHarness({
			settings: { reproducibility: { seed: 42 } },
		});
		harnesses.push(harness);
		const assistant = fauxAssistantMessage("ok", { responseId: "chatcmpl_1" });
		assistant.systemFingerprint = "fp_abc123";
		harness.setResponses([assistant]);
		await harness.session.prompt("hi");

		const steps = harness.sessionManager.getAuditSteps<AuditStepRecord>();
		expect(steps).toHaveLength(1);
		expect(isValidAuditStep(steps[0])).toBe(true);
		expect(steps[0]).toMatchObject({
			systemFingerprint: "fp_abc123",
			providerRequestId: "chatcmpl_1",
			seed: 42,
		});
	});

	it("warns for non-seed providers and refuses them in strict_audit", async () => {
		const resolved = resolveReproducibility({ settings: { seed: 42 } });
		expect(formatDeterminismWarning("anthropic", resolved)).toMatch(/cannot honor determinism/);
		expect(formatDeterminismWarning("faux", resolved)).toBeUndefined();

		const harness = await createHarness({
			settings: { reproducibility: { mode: "strict_audit", seed: 42 } },
		});
		harnesses.push(harness);
		const model = harness.getModel();
		harness.session.agent.state.model = { ...model, provider: "anthropic", id: "claude-sonnet-4-6" };
		harness.setResponses([fauxAssistantMessage("nope")]);
		await expect(harness.session.prompt("hi")).rejects.toThrow(/strict_audit refuses/);
	});
});
