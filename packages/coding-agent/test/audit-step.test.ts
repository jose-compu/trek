/**
 * 0.7.0 Audit — per-LLM-step JSONL record (#73).
 * Run: npx vitest run test/audit-step.test.ts --reporter=verbose
 */

import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	AUDIT_STEP_SCHEMA_VERSION,
	type AuditStepRecord,
	buildAuditStep,
	createAuditStepId,
	isValidAuditStep,
	parseAuditStep,
	resolveReproducibility,
} from "../src/core/reproducibility/index.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("audit step schema (#73)", () => {
	const resolved = resolveReproducibility({ settings: { seed: 42 } });
	const assistant = fauxAssistantMessage("ok", {
		responseId: "resp_1",
		timestamp: Date.parse("2026-09-01T00:00:00.000Z"),
	});
	assistant.systemFingerprint = "fp_abc123";

	it("builds a TypeBox-valid record with fingerprint and request id", () => {
		const record = buildAuditStep({
			stepNumber: 1,
			assistant,
			priorMessages: [{ role: "user", content: "hello" }],
			reproducibility: resolved,
			toolNames: ["bash", "read"],
			skillNames: [],
			clock: () => new Date("2026-09-01T00:00:00.000Z"),
		});
		expect(isValidAuditStep(record)).toBe(true);
		expect(parseAuditStep(record)).toEqual(record);
		expect(record).toMatchObject({
			schemaVersion: AUDIT_STEP_SCHEMA_VERSION,
			stepId: "s-0001",
			seed: 42,
			systemFingerprint: "fp_abc123",
			providerRequestId: "resp_1",
			retrievedLessonIds: [],
			timestamp: "2026-09-01T00:00:00.000Z",
		});
		expect(record.inputHash).toMatch(/^[0-9a-f]{16}$/);
		expect(record.outputHash).toMatch(/^[0-9a-f]{16}$/);
	});

	it("rejects a malformed payload", () => {
		expect(parseAuditStep({ schemaVersion: 1, stepId: "s-0001" })).toBeUndefined();
		expect(createAuditStepId(12)).toBe("s-0012");
	});
});

describe("session JSONL trek:audit_step (#73)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("writes one record per LLM step and copies system_fingerprint", async () => {
		const harness = await createHarness({
			settings: { reproducibility: { seed: 42 } },
		});
		harnesses.push(harness);
		const first = fauxAssistantMessage("first", { responseId: "req_a" });
		first.systemFingerprint = "fp_live";
		harness.setResponses([first, fauxAssistantMessage("second")]);
		await harness.session.prompt("hello");
		harness.setResponses([fauxAssistantMessage("second")]);
		await harness.session.prompt("again");

		const steps = harness.sessionManager.getAuditSteps<AuditStepRecord>();
		expect(steps).toHaveLength(2);
		expect(steps.every((step) => isValidAuditStep(step))).toBe(true);
		expect(steps[0]).toMatchObject({
			stepId: "s-0001",
			seed: 42,
			systemFingerprint: "fp_live",
			providerRequestId: "req_a",
			retrievedLessonIds: [],
		});
		expect(steps[1]?.stepId).toBe("s-0002");
		expect(steps[1]?.systemFingerprint).toBeUndefined();
		expect(steps[0]?.inputHash).not.toBe(steps[1]?.inputHash);
	});
});
