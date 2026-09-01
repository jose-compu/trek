/**
 * Per-LLM-step audit record (0.7.0, REFLECTIVE §12.4).
 * Logical reproducibility when bit-exact replay is impossible.
 * Session JSONL customType: trek:audit_step.
 */

import { createHash } from "node:crypto";
import type { AssistantMessage } from "@trek/ai";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import {
	AUDIT_STEP_CUSTOM_TYPE,
	AUDIT_STEP_SCHEMA_VERSION,
	type AuditStepRecord,
	type ResolvedReproducibility,
} from "./types.ts";

export const AuditStepSchema = Type.Object({
	schemaVersion: Type.Literal(AUDIT_STEP_SCHEMA_VERSION),
	stepId: Type.String({ minLength: 1 }),
	model: Type.String({ minLength: 1 }),
	modelVersion: Type.Optional(Type.String()),
	seed: Type.Integer({ minimum: 0 }),
	temperature: Type.Number(),
	topP: Type.Number(),
	systemFingerprint: Type.Optional(Type.String()),
	providerRequestId: Type.Optional(Type.String()),
	inputHash: Type.String({ minLength: 1 }),
	outputHash: Type.String({ minLength: 1 }),
	toolsAvailableHash: Type.String({ minLength: 1 }),
	skillsActiveHash: Type.String({ minLength: 1 }),
	retrievedLessonIds: Type.Array(Type.String()),
	timestamp: Type.String({ minLength: 1 }),
});

export type AuditStepSchemaType = Static<typeof AuditStepSchema>;

const validateAuditStep = Compile(AuditStepSchema);

export function createAuditStepId(stepNumber: number): string {
	return `s-${String(stepNumber).padStart(4, "0")}`;
}

export function hashAuditPayload(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
	if (value === undefined) {
		return "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const rec = value as Record<string, unknown>;
		const keys = Object.keys(rec).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(rec[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export interface HashableMessage {
	role: string;
	content?: unknown;
	model?: string;
	toolName?: string;
	isError?: boolean;
}

export function digestMessage(message: HashableMessage): unknown {
	if (message.role === "user") {
		return { role: "user", content: message.content };
	}
	if (message.role === "assistant") {
		return { role: "assistant", content: message.content, model: message.model };
	}
	if (message.role === "toolResult") {
		return {
			role: "toolResult",
			toolName: message.toolName,
			content: message.content,
			isError: message.isError,
		};
	}
	return { role: message.role };
}

export function hashMessages(messages: readonly HashableMessage[]): string {
	return hashAuditPayload(messages.map(digestMessage));
}

export function hashNameList(names: string[]): string {
	return hashAuditPayload([...names].sort());
}

export interface BuildAuditStepInput {
	stepNumber: number;
	assistant: AssistantMessage;
	priorMessages: readonly HashableMessage[];
	reproducibility: ResolvedReproducibility;
	toolNames: string[];
	skillNames: string[];
	/** Empty until 0.11.0 Memory. */
	retrievedLessonIds?: string[];
	clock?: () => Date;
}

export function buildAuditStep(input: BuildAuditStepInput): AuditStepRecord {
	const modelVersion =
		input.assistant.responseModel && input.assistant.responseModel !== input.assistant.model
			? input.assistant.responseModel
			: input.assistant.model;
	const record: AuditStepRecord = {
		schemaVersion: AUDIT_STEP_SCHEMA_VERSION,
		stepId: createAuditStepId(input.stepNumber),
		model: input.assistant.model,
		modelVersion,
		seed: input.reproducibility.seed,
		temperature: input.reproducibility.temperature,
		topP: input.reproducibility.topP,
		inputHash: hashMessages(input.priorMessages),
		outputHash: hashAuditPayload(input.assistant.content),
		toolsAvailableHash: hashNameList(input.toolNames),
		skillsActiveHash: hashNameList(input.skillNames),
		retrievedLessonIds: input.retrievedLessonIds ?? [],
		timestamp: (input.clock?.() ?? new Date(input.assistant.timestamp)).toISOString(),
	};
	if (input.assistant.systemFingerprint) {
		record.systemFingerprint = input.assistant.systemFingerprint;
	}
	if (input.assistant.responseId) {
		record.providerRequestId = input.assistant.responseId;
	}
	return record;
}

export function parseAuditStep(data: unknown): AuditStepRecord | undefined {
	if (!validateAuditStep.Check(data)) {
		return undefined;
	}
	return data as AuditStepRecord;
}

export function isValidAuditStep(data: unknown): data is AuditStepRecord {
	return validateAuditStep.Check(data);
}

export { AUDIT_STEP_CUSTOM_TYPE, validateAuditStep };
