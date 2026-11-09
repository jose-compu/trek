/**
 * Multi-workflow catalog tests for issue #236.
 * Coding domain has multiple workflows with term-based selection.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadDomainCatalog } from "../src/core/domains/catalog.ts";
import { selectDomain } from "../src/core/domains/select.ts";

describe("multi-workflow catalog", () => {
	test("coding domain loads with multiple workflows", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-multi-workflow-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		expect(coding).toBeDefined();
		expect(coding?.workflows).toBeDefined();
		expect(coding?.workflows?.length).toBeGreaterThanOrEqual(10);
		const workflowNames = coding?.workflows?.map((workflow) => workflow.name) ?? [];
		expect(workflowNames).toContain("defect-fix");
		expect(workflowNames).toContain("belay-pr");
		expect(workflowNames).toContain("open-issue");
		expect(workflowNames).toContain("branch-from-issue");
		expect(workflowNames).toContain("commit-on-branch");
		expect(workflowNames).toContain("open-pr");
		expect(workflowNames).toContain("review-pr");
		expect(workflowNames).toContain("address-review");
		expect(workflowNames).toContain("merge-pr");
		expect(workflowNames).toContain("split-release-epics");
		expect(workflowNames).toContain("split-epic-issues");
	});

	test("finance and engineering remain single-workflow domains", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-single-workflow-"));
		const catalog = loadDomainCatalog(cwd);
		const finance = catalog.domains.find((domain) => domain.id === "finance");
		const engineering = catalog.domains.find((domain) => domain.id === "engineering");
		expect(finance?.workflows).toBeUndefined();
		expect(engineering?.workflows).toBeUndefined();
		expect(finance?.workflowName).toBe("control-break");
		expect(engineering?.workflowName).toBe("change-review");
	});

	test("open-issue workflow is selected for open issue prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-open-issue-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "Open an issue for the login bug" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("open-issue");
	});

	test("open-pr workflow is selected for pull request prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-open-pr-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "Create a pull request for this change" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("open-pr");
	});

	test("review-pr workflow is selected for review prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-review-pr-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "Approve the PR after reviewing" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("review-pr");
	});

	test("belay workflow is selected for belay prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "Belay this pull request" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("belay-pr");
	});

	test("split-release-epics workflow is selected for split release prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-split-release-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, {
			task: "Break down this release into epics for the milestone",
		});
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("split-release-epics");
	});

	test("split-epic-issues workflow is selected for split epic prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-split-epic-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "Break down the epic into child issues" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("split-epic-issues");
	});

	test("defect-fix workflow is selected for defect prompt", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-defect-fix-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "The lint error is in the module" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("defect-fix");
	});

	test("all coding workflows parse as valid Archon", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-parse-workflows-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		expect(coding?.workflows).toBeDefined();
		for (const workflow of coding?.workflows ?? []) {
			expect(workflow.workflow.name).toBe(workflow.name);
			expect(workflow.workflow.nodes.length).toBeGreaterThan(0);
			for (const node of workflow.workflow.nodes) {
				expect(node.kind).toBe("prompt");
				expect(node.allowedTools).toEqual([]);
				expect(node.outputType).toBe("findings");
			}
		}
	});

	test("commit-on-branch workflow refuses AI co-author trailers", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-commit-refuse-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const commitWorkflow = coding?.workflows?.find((workflow) => workflow.name === "commit-on-branch");
		expect(commitWorkflow).toBeDefined();
		const refuseNode = commitWorkflow?.workflow.nodes.find((node) => node.id === "refuse-ai-trailer");
		expect(refuseNode).toBeDefined();
		expect(refuseNode?.body).toContain("AI");
		expect(refuseNode?.body).toContain("LLM");
		expect(refuseNode?.body).toContain("co-author");
		expect(refuseNode?.body).toContain("refuse");
	});
});
