/**
 * Multi-workflow catalog tests for issue #236.
 * Coding domain has multiple workflows with term-based selection.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadDomainCatalog } from "../src/core/domains/catalog.ts";
import { workflowNeedsFacts } from "../src/core/domains/parameters.ts";
import { selectDomain } from "../src/core/domains/select.ts";
import { runDomainSessionCommand } from "../src/core/domains/session-command.ts";

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
		expect(workflowNames).toContain("publish-release");
		expect(workflowNames).toContain("split-release-epics");
		expect(workflowNames).toContain("split-epic-issues");
	});

	test("/domains lists lesson categories and /workflows lists coding DAGs", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-domain-help-"));
		const domains = runDomainSessionCommand(cwd, "domains", "");
		expect(domains).toMatch(/│ workflows\s+/);
		expect(domains).toMatch(/│ features\s+/);
		expect(domains).toMatch(/coding/);
		expect(domains).toContain("open-pr");
		expect(domains).toContain("review-pr");
		expect(domains).toContain("defect-fix");
		expect(domains).toMatch(/lessons:.*bug_pattern/);
		expect(domains).toMatch(/fields:.*error_class/);
		expect(domains).toContain("host-adapters");
		expect(domains).toContain("14-layer-DAGs");
		const codingHelp = runDomainSessionCommand(cwd, "domains", "coding");
		expect(codingHelp).toContain("coding  Coding");
		expect(codingHelp).toContain("categories: bug_pattern");
		expect(codingHelp).toContain("coding workflows");
		expect(codingHelp).toContain("open-pr");
		expect(codingHelp).toContain("review pr");
		expect(runDomainSessionCommand(cwd, "domains", "show finance")).toContain("finance");
		expect(runDomainSessionCommand(cwd, "domains", "missing")).toMatch(/unknown domain missing/);
		const workflows = runDomainSessionCommand(cwd, "workflows", "");
		expect(workflows).toContain("coding workflows");
		expect(workflows).toContain("open-pr");
		expect(workflows).toContain("review-pr");
		expect(workflows).toContain("open a pr");
		expect(workflows).toContain("layer workflows");
		const shown = runDomainSessionCommand(cwd, "workflows", "show coding");
		expect(shown).toContain("coding workflows");
		expect(shown).toContain("defect-fix");
		expect(shown).toContain("/workflows show <workflow>");
		const openPr = runDomainSessionCommand(cwd, "workflows", "show open-pr");
		expect(openPr).toContain("coding  open-pr");
		expect(openPr).toMatch(/│ node\s+│/);
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

	test("review pr does not ask for lint and type facts", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-review-pr-facts-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "review pr" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("review-pr");
		expect(workflowNeedsFacts(selection.domain, selection.workflow ? "review pr" : "", selection.workflow)).toBe(
			false,
		);
		expect(workflowNeedsFacts("coding", "review pr", "review-pr")).toBe(false);
		expect(workflowNeedsFacts("coding", "fix the bug", "defect-fix")).toBe(true);
		expect(workflowNeedsFacts("coding", "The lint error in foo.ts", "defect-fix")).toBe(false);
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

	test("publish release selects publish-release and not defect-fix", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-publish-release-"));
		const catalog = loadDomainCatalog(cwd);
		const selection = selectDomain(catalog, { task: "pls publish GH release" });
		expect(selection.domain).toBe("coding");
		expect(selection.workflow).toBe("publish-release");
		expect(workflowNeedsFacts("coding", "pls publish GH release", "publish-release")).toBe(false);
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
				expect(["prompt", "include", "fan_out", "loop", "loop_group", "command", "bash", "script"]).toContain(
					node.kind,
				);
				if (node.kind === "prompt") {
					expect(node.allowedTools).toEqual([]);
					expect(node.outputType).toBe("findings");
				}
			}
		}
	});

	test("open-pr includes commit-on-branch and belay-pr", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-open-pr-compose-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const openPr = coding?.workflows?.find((workflow) => workflow.name === "open-pr");
		const includes = openPr?.workflow.nodes
			.filter((node) => node.kind === "include")
			.map((node) => node.include?.workflow);
		expect(includes).toContain("commit-on-branch");
		expect(includes).toContain("belay-pr");
		expect(includes).toContain("_detect-host");
	});

	test("address-review includes commit-on-branch", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-address-compose-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const address = coding?.workflows?.find((workflow) => workflow.name === "address-review");
		const commit = address?.workflow.nodes.find((node) => node.id === "commit");
		expect(commit?.kind).toBe("include");
		expect(commit?.include?.workflow).toBe("commit-on-branch");
	});

	test("split workflows fan_out through open-issue", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-split-fanout-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const splitIssues = coding?.workflows?.find((workflow) => workflow.name === "split-epic-issues");
		const splitRelease = coding?.workflows?.find((workflow) => workflow.name === "split-release-epics");
		const issueFan = splitIssues?.workflow.nodes.find((node) => node.kind === "fan_out");
		const releaseFan = splitRelease?.workflow.nodes.find((node) => node.kind === "fan_out");
		expect(issueFan?.fanOut).toMatchObject({
			items: "$draft-issues.output",
			workflow: "open-issue",
			join: "all_success",
		});
		expect(releaseFan?.fanOut).toMatchObject({
			items: "$draft-child-epics.output",
			workflow: "open-issue",
			join: "all_success",
		});
		expect(splitRelease?.workflow.nodes.some((node) => node.include?.workflow === "open-issue")).toBe(true);
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
