import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { grokModelSupportsReasoningEffort } from "../src/providers/openai-completions.ts";
import { streamSimple } from "../src/stream.ts";
import { REPETITIVE_STREAM_ERROR } from "../src/utils/stream-repetition.ts";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
	chunks: undefined as
		| Array<{
				id?: string;
				choices?: Array<{ delta: Record<string, unknown>; finish_reason: string | null }>;
		  }>
		| undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							const chunks = mockState.chunks ?? [
								{
									choices: [{ delta: {}, finish_reason: "stop" }],
								},
							];
							for (const chunk of chunks) {
								yield chunk;
							}
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

const LOOP_PHRASE =
	"Let me 1. Create SPICE netlists for the 4 designs 2. Create a Python runner that invokes ngspice 3. Fix run_simulations.py ";

describe("xAI Grok reasoning_effort and stream loop", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
		mockState.chunks = undefined;
	});

	it("recognizes Grok 4.5/4.6 ids only", () => {
		expect(grokModelSupportsReasoningEffort("grok-4.6")).toBe(true);
		expect(grokModelSupportsReasoningEffort("x-ai/grok-4.5")).toBe(true);
		expect(grokModelSupportsReasoningEffort("grok-3")).toBe(false);
		expect(grokModelSupportsReasoningEffort("grok-4.20-0309-reasoning")).toBe(false);
		expect(grokModelSupportsReasoningEffort("grok-code-fast-1")).toBe(false);
	});

	it("sends reasoning_effort for xAI grok-4.6", async () => {
		const model = getModel("xai", "grok-4.6")!;
		let payload: unknown;

		await streamSimple(
			model,
			{
				messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
			},
			{
				apiKey: "test",
				reasoning: "medium",
				onPayload: (params: unknown) => {
					payload = params;
				},
			},
		).result();

		const params = (payload ?? mockState.lastParams) as { reasoning_effort?: string };
		expect(params.reasoning_effort).toBe("medium");
	});

	it("omits reasoning_effort for xAI grok-3", async () => {
		const model = getModel("xai", "grok-3")!;
		let payload: unknown;

		await streamSimple(
			model,
			{
				messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
			},
			{
				apiKey: "test",
				reasoning: "medium",
				onPayload: (params: unknown) => {
					payload = params;
				},
			},
		).result();

		const params = (payload ?? mockState.lastParams) as { reasoning_effort?: string };
		expect(params.reasoning_effort).toBeUndefined();
	});

	it("aborts when reasoning_content repeats the same plan", async () => {
		const model = getModel("xai", "grok-4.6")!;
		mockState.chunks = [
			{
				id: "chatcmpl-loop",
				choices: [
					{
						delta: { reasoning_content: LOOP_PHRASE.repeat(3) },
						finish_reason: null,
					},
				],
			},
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
			},
		];

		const response = await streamSimple(
			model,
			{
				messages: [{ role: "user", content: "Continue the project", timestamp: Date.now() }],
			},
			{ apiKey: "test", reasoning: "medium" },
		).result();

		expect(response.stopReason).toBe("error");
		expect(response.errorMessage).toBe(REPETITIVE_STREAM_ERROR);
	});
});
