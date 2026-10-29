/**
 * A prompt creates, edits, or restores a domain workflow.
 * The previous YAML stays under .trek/domains/<id>/history/.
 * Run: PI_NO_LOCAL_LLM=1 npx vitest --run test/workflow-edit.test.ts --reporter=verbose
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, test } from "vitest";
import {
	bundledDomainsRoot,
	enableDomain,
	loadDomainCatalog,
	restoreDomainWorkflow,
	saveDomainWorkflow,
} from "../src/core/domains/catalog.ts";
import { selectDomain } from "../src/core/domains/select.ts";
import { parseWorkflowEdit } from "../src/core/domains/workflow-edit.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const WAREHOUSE = [
	"name: oxblood-check",
	"description: Look up the oxblood pump serial.",
	"nodes:",
	"  - id: read-serial",
	"    prompt: Read the serial on the oxblood pump.",
	"",
].join("\n");

const CLOSE = [
	"name: close-check",
	"description: A closer pass on the break.",
	"nodes:",
	"  - id: name-clerk",
	"    prompt: Name the clerk who owns the break.",
	"",
].join("\n");

const LAYER = [
	"name: layer-check",
	"description: Quote the layer rule.",
	"nodes:",
	"  - id: quote-rule",
	"    prompt: Quote the layer rule.",
	"",
].join("\n");

describe("workflow edit", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	test("an edit keeps the previous finance workflow and does not change the package file", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const cwd = harness.tempDir;
		const packaged = readFileSync(join(bundledDomainsRoot(), "engineering", "change-review.yaml"), "utf8");
		const saved = saveDomainWorkflow(cwd, "finance", CLOSE);
		expect(saved.backedUp).toBe(true);
		expect(saved.created).toBe(false);
		const edited = loadDomainCatalog(cwd);
		expect(edited.domains).toHaveLength(20);
		expect(edited.domains.filter((domain) => domain.id === "finance")).toHaveLength(1);
		expect(edited.domains.find((domain) => domain.id === "finance")?.nodeIds).toEqual(["name-clerk"]);
		expect(restoreDomainWorkflow(cwd, "finance").name).toBe("control-break");
		expect(loadDomainCatalog(cwd).domains.find((domain) => domain.id === "finance")?.nodeIds).toContain(
			"name-account",
		);
		expect(() => restoreDomainWorkflow(cwd, "finance")).toThrow(/no previous finance workflow/);
		saveDomainWorkflow(cwd, "engineering", LAYER);
		const engineering = loadDomainCatalog(cwd).domains.find((domain) => domain.id === "engineering");
		expect(engineering?.alwaysOn).toBe(true);
		expect(engineering?.workflowName).toBe("layer-check");
		expect(readFileSync(join(bundledDomainsRoot(), "engineering", "change-review.yaml"), "utf8")).toBe(packaged);
	});

	test("a new workflow starts off until it is enabled", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const cwd = harness.tempDir;
		const saved = saveDomainWorkflow(cwd, "warehouse", WAREHOUSE);
		expect(saved.created).toBe(true);
		expect(loadDomainCatalog(cwd).disabled.has("warehouse")).toBe(true);
		expect(selectDomain(loadDomainCatalog(cwd), { task: "Where is the oxblood pump serial?" }).domain).toBe("none");
		enableDomain(cwd, "warehouse");
		const selected = selectDomain(loadDomainCatalog(cwd), { task: "Where is the oxblood pump serial?" });
		expect(selected.domain).toBe("warehouse");
		expect(selected.workflow).toBe("oxblood-check");
	});

	test("a prompt that already contains YAML does not call the model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("should not run")]);
		await harness.session.prompt(`create a domain workflow for warehouse:\n${WAREHOUSE}`);
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(assistantText(harness)).toContain("Saved warehouse workflow oxblood-check");
		expect(assistantText(harness)).toContain("/domains enable warehouse");
		expect(existsSync(join(harness.tempDir, ".trek", "domains", "warehouse", "domain.json"))).toBe(true);
	});

	test("a thin create asks once and stops without writing", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		await harness.session.prompt("create a domain workflow for warehouse");
		expect(assistantText(harness)).toContain("What should the warehouse workflow do?");
		expect(harness.getPendingResponseCount()).toBe(0);
		await harness.session.prompt("stop");
		expect(assistantText(harness)).toContain("Workflow stopped. warehouse was not written.");
		expect(existsSync(join(harness.tempDir, ".trek", "domains", "warehouse", "domain.json"))).toBe(false);
	});

	test("a prose edit uses one draft and restore goes back", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage(CLOSE)]);
		await harness.session.prompt("edit the finance workflow: add a step that names the clerk who owns the break.");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(assistantText(harness)).toContain("Saved finance workflow close-check");
		expect(loadDomainCatalog(harness.tempDir).domains.find((domain) => domain.id === "finance")?.workflowName).toBe(
			"close-check",
		);
		await harness.session.prompt("restore the finance workflow");
		expect(loadDomainCatalog(harness.tempDir).domains.find((domain) => domain.id === "finance")?.workflowName).toBe(
			"control-break",
		);
		expect(assistantText(harness)).toContain("Restored finance workflow control-break.");
		expect(parseWorkflowEdit("The build failed on the adapter.")).toBeUndefined();
	});
});

function assistantText(harness: Harness): string {
	const lines: string[] = [];
	for (const message of harness.session.messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") lines.push(part.text);
		}
	}
	return lines.join("\n");
}
