/**
 * Workflow gate for 0.13.1.
 * Every bundled workflow is a prompt DAG. A reply is checked against the turn.
 * The check and the session command do not run a tool.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, test } from "vitest";
import { orderNodes, parseArchonWorkflow } from "../src/core/domains/archon.ts";
import { loadDomainCatalog } from "../src/core/domains/catalog.ts";
import { checkWorkflowNodes, formatWorkflowCheck } from "../src/core/domains/node-check.ts";
import { fillWorkflowParameters, missingWorkflowFacts } from "../src/core/domains/parameters.ts";
import { runArchonWorkflow } from "../src/core/domains/run.ts";
import { selectDomain } from "../src/core/domains/select.ts";
import { runDomainSessionCommand } from "../src/core/domains/session-command.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const FINANCE_TURN = "The reconciliation break for account 4100 in March is 1200. The SOX control is the bank rec.";
const ENGINEERING_TURN =
	"The build failed on the adapter. The architecture violation is the layer rule. The tech debt is the empty adapter.";

describe("workflow gate", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	test("every bundled workflow is an acyclic prompt DAG", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-workflow-catalog-"));
		const catalog = loadDomainCatalog(cwd);
		expect(catalog.domains).toHaveLength(20);
		for (const domain of catalog.domains) {
			expect(domain.workflow.nodes.length).toBeGreaterThan(0);
			expect(new Set(domain.nodeIds).size).toBe(domain.nodeIds.length);
			const ordered = orderNodes(domain.workflow);
			expect(ordered.map((node) => node.id)).toEqual(domain.nodeIds);
			for (const node of ordered) {
				expect(node.kind).toBe("prompt");
				expect(node.body.length).toBeGreaterThan(0);
				for (const dep of node.dependsOn) {
					expect(domain.nodeIds).toContain(dep);
					expect(domain.nodeIds.indexOf(dep)).toBeLessThan(domain.nodeIds.indexOf(node.id));
				}
			}
		}
	});

	test("finance calls name-account, quantify-break, cite-control, then propose-entry", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-workflow-finance-"));
		const marker = join(cwd, "journal.txt");
		writeFileSync(marker, "untouched");
		const finance = loadDomainCatalog(cwd).domains.find((domain) => domain.id === "finance");
		expect(finance?.workflowName).toBe("control-break");
		if (!finance) throw new Error("finance missing");
		const prompts: string[] = [];
		const results = await runArchonWorkflow(finance.workflow, {
			cwd,
			userMessage: FINANCE_TURN,
			runPrompt: async (prompt) => {
				prompts.push(prompt);
				return "account 4100, March, 1200";
			},
		});
		expect(results.map((result) => result.id)).toEqual([
			"name-account",
			"quantify-break",
			"cite-control",
			"propose-entry",
		]);
		expect(prompts).toHaveLength(4);
		for (const prompt of prompts) {
			expect(prompt).toContain("Answer only this Archon node.");
			expect(prompt).toContain(FINANCE_TURN);
			expect(prompt).toContain("not in the turn");
		}
		expect(prompts[1]).toContain("$name-account.output:");
		expect(prompts[1]).toContain("account 4100, March, 1200");
		expect(prompts[3]).toContain("Do not post it.");
		expect(readFileSync(marker, "utf8")).toBe("untouched");
		const grounded = checkWorkflowNodes(
			FINANCE_TURN,
			results.map((result, index) => ({
				id: result.id,
				prompt: finance.workflow.nodes[index]?.body ?? "",
				output: result.output,
			})),
		);
		expect(grounded).toEqual([]);
	});

	test("a finance reply that invents a side is marked, and a stated absence is not", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-workflow-check-"));
		const marker = join(cwd, "journal.txt");
		writeFileSync(marker, "untouched");
		const finance = loadDomainCatalog(cwd).domains.find((domain) => domain.id === "finance");
		if (!finance) throw new Error("finance missing");
		const propose = finance.workflow.nodes.find((node) => node.id === "propose-entry");
		const invented = checkWorkflowNodes(FINANCE_TURN, [
			{
				id: "propose-entry",
				prompt: propose?.body ?? "",
				output: "debit or credit the appropriate accounts",
			},
		]);
		expect(invented).toEqual([expect.objectContaining({ id: "propose-entry", kind: "not-in-turn" })]);
		expect(invented[0]?.detail).toContain("debit");
		expect(invented[0]?.detail).toContain("credit");
		expect(formatWorkflowCheck(invented)).toBe(
			`workflow check\npropose-entry: fact not in the turn (${invented[0]?.detail})`,
		);
		const absent = checkWorkflowNodes(FINANCE_TURN, [
			{
				id: "propose-entry",
				prompt: propose?.body ?? "",
				output: "The sides of the entry are not in the turn. Do not post it.",
			},
		]);
		expect(absent).toEqual([]);
		const number = checkWorkflowNodes(FINANCE_TURN, [
			{
				id: "quantify-break",
				prompt: "Separate what is known from what is estimated. Do not invent a balance.",
				output: "The estimated balance is 9999.",
			},
		]);
		expect(number[0]?.kind).toBe("not-in-turn");
		expect(number[0]?.detail).toContain("9999");
		expect(readFileSync(marker, "utf8")).toBe("untouched");
	});

	test("an empty node is skipped, and a later invention is still marked", () => {
		const findings = checkWorkflowNodes(FINANCE_TURN, [
			{ id: "cite-control", prompt: "Name the SOX control.", output: "   " },
			{
				id: "propose-entry",
				prompt: "Propose the correcting entry in words. Do not post it.",
				output: "The sides are not in the turn.\nDebit the suspense ledger.",
			},
			{ id: "name-account", prompt: "Name the account.", output: "ok" },
		]);
		expect(findings.map((finding) => `${finding.id}:${finding.kind}`)).toEqual([
			"cite-control:skipped",
			"propose-entry:not-in-turn",
			"name-account:skipped",
		]);
		expect(findings[1]?.detail).toContain("debit");
		expect(findings[1]?.detail).toContain("suspense");
		expect(formatWorkflowCheck(findings)).toContain("cite-control: skipped");
		expect(formatWorkflowCheck(findings)).not.toContain("bash");
	});

	test("a refused bash node, a command node, and a cycle do not run", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-workflow-refuse-"));
		writeFileSync(join(cwd, "keep.txt"), "stay");
		const refused = parseArchonWorkflow(
			["name: wipe", "description: must not run", "nodes:", "  - id: wipe", "    bash: rm -rf keep.txt", ""].join(
				"\n",
			),
		);
		await expect(runArchonWorkflow(refused, cwd)).rejects.toThrow(/refused bash node wipe/);
		expect(readFileSync(join(cwd, "keep.txt"), "utf8")).toBe("stay");
		expect(existsSync(join(cwd, "keep.txt"))).toBe(true);

		const command = parseArchonWorkflow(
			["name: cmd", "description: a named command", "nodes:", "  - id: go", "    command: post-journal", ""].join(
				"\n",
			),
		);
		await expect(runArchonWorkflow(command, cwd)).rejects.toThrow(/command node go/);

		const script = parseArchonWorkflow(
			[
				"name: scr",
				"description: a script node",
				"nodes:",
				"  - id: go",
				"    script: print(1)",
				"    runtime: bun",
				"",
			].join("\n"),
		);
		await expect(runArchonWorkflow(script, cwd)).rejects.toThrow(/script node go/);

		const promptOnly = parseArchonWorkflow(
			["name: ask", "description: needs a model", "nodes:", "  - id: ask", "    prompt: Name the account.", ""].join(
				"\n",
			),
		);
		await expect(runArchonWorkflow(promptOnly, cwd)).rejects.toThrow(/prompt node ask is an AI step/);

		expect(() =>
			parseArchonWorkflow(
				[
					"name: cycle",
					"description: a loop in the graph",
					"nodes:",
					"  - id: a",
					"    prompt: one",
					"    depends_on: [b]",
					"  - id: b",
					"    prompt: two",
					"    depends_on: [a]",
					"",
				].join("\n"),
			),
		).toThrow(/cycle/);
		expect(readFileSync(join(cwd, "keep.txt"), "utf8")).toBe("stay");
	});

	test("the session command refuses always-on domains and leaves engineering selectable", async () => {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		const cwd = harness.tempDir;
		for (const id of ["engineering", "meta", "ai", "security"]) {
			expect(harness.session.runDomainCommand("domains", `disable ${id}`)).toMatch(/cannot be disabled/);
		}
		expect(harness.session.runDomainCommand("domains", "enable")).toMatch(/usage: \/domains enable/);
		expect(harness.session.runDomainCommand("domains", "disable missing")).toMatch(/unknown domain missing/);
		expect(harness.session.runDomainCommand("workflows", "show missing")).toMatch(/unknown domain missing/);
		expect(harness.session.runDomainCommand("workflows", "enable finance")).toMatch(/does not run a workflow/);
		expect(harness.session.runDomainCommand("domains", "nope")).toMatch(/usage: \/domains/);
		expect(runDomainSessionCommand(cwd, "workflows", "")).toBe(runDomainSessionCommand(cwd, "domains", ""));
		const shown = harness.session.runDomainCommand("workflows", "show engineering");
		expect(shown).toContain("engineering  change-review");
		expect(shown).toMatch(/│ state-constraint\s+│/);
		expect(shown).not.toContain("name: change-review");
		expect(harness.session.completeDomainCommand("workflows", "show f").map((item) => item.value)).toContain(
			"show finance",
		);
		expect(harness.session.completeDomainCommand("domains", "disable e")).toEqual([]);

		harness.setResponses([
			fauxAssistantMessage("the layer rule"),
			fauxAssistantMessage("no build was run"),
			fauxAssistantMessage("the empty adapter"),
			fauxAssistantMessage("refuse to edit"),
		]);
		await harness.session.prompt(ENGINEERING_TURN);
		expect(selectDomain(loadDomainCatalog(cwd), { task: ENGINEERING_TURN }).workflow).toBe("change-review");
		expect(harness.session.getWorkflowCheck()).toBeUndefined();
		expect(harness.eventsOfType("workflow_check")).toEqual([]);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	test("disabling finance drops it from the next turn, and enabling it restores the DAG", async () => {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		expect(harness.session.runDomainCommand("domains", "disable finance")).toMatch(
			/│ finance\s+│ off\s+│ control-break\s+│/,
		);
		harness.setResponses([fauxAssistantMessage("no finance card")]);
		await harness.session.prompt(FINANCE_TURN);
		expect(harness.session.getWorkflowCheck()).toBeUndefined();
		expect(assistantCount(harness)).toBe(1);
		expect(selectDomain(loadDomainCatalog(harness.tempDir), { task: FINANCE_TURN }).domain).not.toBe("finance");

		expect(harness.session.runDomainCommand("domains", "enable finance")).toMatch(
			/│ finance\s+│ on\s+│ control-break\s+│/,
		);
		harness.setResponses([
			fauxAssistantMessage("account 4100, March, 1200"),
			fauxAssistantMessage("the known break is 1200"),
			fauxAssistantMessage("the SOX control is the bank rec"),
			fauxAssistantMessage("debit or credit the appropriate accounts"),
		]);
		await harness.session.prompt(FINANCE_TURN);
		expect(assistantCount(harness)).toBe(5);
		const checks = harness.eventsOfType("workflow_check");
		expect(checks).toHaveLength(1);
		expect(checks[0]?.text).toContain("propose-entry: fact not in the turn");
		expect(checks[0]?.text).toContain("debit");
		expect(harness.session.getWorkflowCheck()).toContain("propose-entry");
		expect(selectDomain(loadDomainCatalog(harness.tempDir), { task: FINANCE_TURN }).workflow).toBe("control-break");
	});

	test("a complete engineering turn keeps the layer rule and does not ask", () => {
		expect(missingWorkflowFacts("engineering", ENGINEERING_TURN)).toEqual([]);
		expect(missingWorkflowFacts("engineering", "The build failed.")).toEqual(["build", "violation", "debt"]);
		const violation = fillWorkflowParameters("engineering", ENGINEERING_TURN, []).find(
			(fact) => fact.name === "violation",
		);
		expect(violation?.value).toContain("layer rule");
	});

	test("an honesty footer is not a missing fact", () => {
		const findings = checkWorkflowNodes(ENGINEERING_TURN, [
			{
				id: "state-constraint",
				prompt: "Quote the architecture violation.",
				output: "the layer rule\n<honesty>\nconfidence: medium\nassumption: none\nunverified: none\n</honesty>",
			},
		]);
		expect(findings).toEqual([]);
	});

	test("a thin engineering turn asks once and stops when the user will not provide the facts", async () => {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		await harness.session.prompt("The build failed.");
		expect(assistantText(harness)).toContain("Which build, violation and debt");
		expect(assistantText(harness)).toContain("Say stop");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.session.getWorkflowCheck()).toBeUndefined();

		await harness.session.prompt("stop");
		expect(assistantText(harness)).toContain("Workflow stopped. engineering did not receive build, violation, debt.");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(assistantCount(harness)).toBe(2);
	});

	test("a follow-up that names the missing facts starts the DAG", async () => {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		await harness.session.prompt("The build failed.");
		expect(harness.getPendingResponseCount()).toBe(0);
		harness.setResponses([
			fauxAssistantMessage("the layer rule"),
			fauxAssistantMessage("the build failed"),
			fauxAssistantMessage("the empty adapter"),
			fauxAssistantMessage("refuse to edit"),
		]);
		await harness.session.prompt("The architecture violation is the layer rule. The tech debt is the empty adapter.");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(assistantCount(harness)).toBe(5);
		expect(harness.session.getWorkflowCheck()).toBeUndefined();
	});
});

function assistantCount(harness: Harness): number {
	return harness.session.messages.filter((message) => message.role === "assistant").length;
}

function assistantText(harness: Harness): string {
	return harness.session.messages
		.filter((message) => message.role === "assistant")
		.flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text))
		.join("\n");
}
