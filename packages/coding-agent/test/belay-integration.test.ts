/**
 * Belay integration tests for issue #266.
 * Verify open-pr includes Belay and merge-pr checks for Belay LGTM.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadDomainCatalog } from "../src/core/domains/catalog.ts";

describe("belay integration", () => {
	test("open-pr includes belay-pr workflow", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-open-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const openPr = coding?.workflows?.find((w) => w.name === "open-pr");
		expect(openPr).toBeDefined();
		const belayNode = openPr?.workflow.nodes.find((node) => node.id === "belay");
		expect(belayNode).toBeDefined();
		expect(belayNode?.kind).toBe("include");
		expect(belayNode?.include?.workflow).toBe("belay-pr");
		expect(belayNode?.returns).toBe("$belay.verdict.output");
		const openCommand = openPr?.workflow.nodes.find((node) => node.id === "open-pr-command");
		expect(openCommand?.body).toContain("$belay.output");
		expect(openCommand?.body).toContain("Belay");
	});

	test("merge-pr includes belay-pr workflow and checks for LGTM", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-merge-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const mergePr = coding?.workflows?.find((w) => w.name === "merge-pr");
		expect(mergePr).toBeDefined();
		const belayNode = mergePr?.workflow.nodes.find((node) => node.id === "belay");
		expect(belayNode).toBeDefined();
		expect(belayNode?.kind).toBe("include");
		expect(belayNode?.include?.workflow).toBe("belay-pr");
		expect(belayNode?.returns).toBe("$belay.verdict.output");
		const checkBelay = mergePr?.workflow.nodes.find((node) => node.id === "check-belay");
		expect(checkBelay).toBeDefined();
		expect(checkBelay?.body).toContain("$belay.output");
		expect(checkBelay?.body).toContain("LGTM");
		expect(checkBelay?.body.toLowerCase()).toContain("refuse");
		const mergeCommand = mergePr?.workflow.nodes.find((node) => node.id === "merge-command");
		expect(mergeCommand?.body).toContain("$check-belay.output");
		expect(mergeCommand?.body).toContain("Belay");
	});

	test("belay-pr workflow has correct structure", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-structure-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const belay = coding?.workflows?.find((w) => w.name === "belay-pr");
		expect(belay).toBeDefined();
		expect(belay?.workflow.nodes.map((n) => n.id)).toEqual(["scope", "findings", "verdict"]);
		for (const node of belay?.workflow.nodes ?? []) {
			expect(node.kind).toBe("prompt");
			expect(node.allowedTools).toEqual([]);
			expect(node.outputType).toBe("findings");
		}
		const verdictNode = belay?.workflow.nodes.find((n) => n.id === "verdict");
		expect(verdictNode?.body).toContain("LGTM");
		expect(verdictNode?.body.toLowerCase()).toContain("not a merge");
	});

	test("belay workflow does not merge", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-no-merge-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const belay = coding?.workflows?.find((w) => w.name === "belay-pr");
		const yaml = belay?.yaml.toLowerCase() ?? "";
		expect(yaml).not.toContain("gh pr merge");
		expect(yaml).not.toContain("merge-pr");
		expect(yaml).toContain("do not merge");
		for (const node of belay?.workflow.nodes ?? []) {
			expect(node.body.toLowerCase()).not.toContain("gh pr merge");
			expect(node.body.toLowerCase()).not.toContain("git merge");
		}
	});

	test("open-pr runs belay before opening PR", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-before-open-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const openPr = coding?.workflows?.find((w) => w.name === "open-pr");
		const nodes = openPr?.workflow.nodes ?? [];
		const belayIndex = nodes.findIndex((n) => n.id === "belay");
		const openIndex = nodes.findIndex((n) => n.id === "open-pr-command");
		expect(belayIndex).toBeGreaterThan(-1);
		expect(openIndex).toBeGreaterThan(-1);
		expect(belayIndex).toBeLessThan(openIndex);
		const openNode = nodes[openIndex];
		expect(openNode?.dependsOn).toContain("detect-host");
	});

	test("merge-pr checks belay before merging", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-belay-before-merge-"));
		const catalog = loadDomainCatalog(cwd);
		const coding = catalog.domains.find((domain) => domain.id === "coding");
		const mergePr = coding?.workflows?.find((w) => w.name === "merge-pr");
		const nodes = mergePr?.workflow.nodes ?? [];
		const belayIndex = nodes.findIndex((n) => n.id === "belay");
		const checkBelayIndex = nodes.findIndex((n) => n.id === "check-belay");
		const mergeIndex = nodes.findIndex((n) => n.id === "merge-command");
		expect(belayIndex).toBeGreaterThan(-1);
		expect(checkBelayIndex).toBeGreaterThan(-1);
		expect(mergeIndex).toBeGreaterThan(-1);
		expect(belayIndex).toBeLessThan(checkBelayIndex);
		expect(checkBelayIndex).toBeLessThan(mergeIndex);
		const mergeNode = nodes[mergeIndex];
		expect(mergeNode?.dependsOn).toContain("check-belay");
	});
});
