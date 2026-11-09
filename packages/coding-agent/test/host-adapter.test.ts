/**
 * Host adapter tests for issue #240.
 * Missing gh/glab/tea should skip gracefully, not crash.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadDomainCatalog } from "../src/core/domains/catalog.ts";

describe("host adapter", () => {
	test("workflows parse without requiring gh/glab/tea binaries", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-host-adapter-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		expect(coding).toBeDefined();
		const hostWorkflows = [
			"open-issue",
			"open-pr",
			"review-pr",
			"address-review",
			"merge-pr",
			"split-release-epics",
			"split-epic-issues",
		];
		for (const workflowName of hostWorkflows) {
			const workflow = coding?.workflows?.find((w) => w.name === workflowName);
			expect(workflow, `workflow ${workflowName} not found`).toBeDefined();
			expect(workflow?.workflow.nodes.length).toBeGreaterThan(0);
			for (const node of workflow?.workflow.nodes ?? []) {
				expect(node.kind).toBe("prompt");
			}
		}
	});

	test("detect-host nodes mention missing CLI gracefully", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-detect-host-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const openIssue = coding?.workflows?.find((w) => w.name === "open-issue");
		const detectHost = openIssue?.workflow.nodes.find((node) => node.id === "detect-host");
		expect(detectHost).toBeDefined();
		expect(detectHost?.body).toContain("gh");
		expect(detectHost?.body).toContain("glab");
		expect(detectHost?.body).toContain("tea");
		expect(detectHost?.body.toLowerCase()).toContain("none are present");
	});

	test("file-issue node handles missing CLI", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-file-issue-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const openIssue = coding?.workflows?.find((w) => w.name === "open-issue");
		const fileIssue = openIssue?.workflow.nodes.find((node) => node.id === "file-issue");
		expect(fileIssue).toBeDefined();
		expect(fileIssue?.body).toContain("detect-host");
		expect(fileIssue?.body.toLowerCase()).toContain("no host cli");
	});

	test("no in-process GitHub or GitLab API imports in workflows", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-no-api-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		for (const workflow of coding?.workflows ?? []) {
			const yaml = workflow.yaml.toLowerCase();
			expect(yaml).not.toContain("@octokit");
			expect(yaml).not.toContain("github api");
			expect(yaml).not.toContain("gitlab api");
			expect(yaml).not.toContain("import");
			expect(yaml).not.toContain("require");
			for (const node of workflow.workflow.nodes) {
				expect(node.kind).toBe("prompt");
				expect(node.allowedTools).toEqual([]);
				expect(node.body.toLowerCase()).not.toContain("octokit");
				expect(node.body.toLowerCase()).not.toContain("api.github.com");
				expect(node.body.toLowerCase()).not.toContain("gitlab.com/api");
			}
		}
	});

	test("workflows use CLI commands, not API calls", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-cli-only-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const openPr = coding?.workflows?.find((w) => w.name === "open-pr");
		expect(openPr).toBeDefined();
		const yaml = openPr?.yaml ?? "";
		expect(yaml.toLowerCase()).toContain("command");
		expect(yaml).not.toContain("fetch(");
		expect(yaml).not.toContain("axios");
		expect(yaml).not.toContain("http.request");
	});

	test("missing binary mentioned in workflow body", () => {
		const workflows = [
			"open-issue",
			"open-pr",
			"review-pr",
			"address-review",
			"merge-pr",
			"split-release-epics",
			"split-epic-issues",
		];
		const cwd = mkdtempSync(join(tmpdir(), "trek-missing-binary-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		for (const workflowName of workflows) {
			const workflow = coding?.workflows?.find((w) => w.name === workflowName);
			expect(workflow, `workflow ${workflowName} not found`).toBeDefined();
			const yaml = workflow?.yaml.toLowerCase() ?? "";
			const hasMissingCheck =
				yaml.includes("no host cli") ||
				yaml.includes("none are present") ||
				yaml.includes("not detected") ||
				yaml.includes("missing") ||
				yaml.includes("not available") ||
				yaml.includes("cannot be") ||
				yaml.includes("without it");
			expect(hasMissingCheck, `${workflowName} should handle missing CLI`).toBe(true);
		}
	});
});
