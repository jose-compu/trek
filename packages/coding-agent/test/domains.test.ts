import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@trek/ai";
import { afterEach, describe, expect, test } from "vitest";
import { loadArchonFile, parseArchonWorkflow } from "../src/core/domains/archon.ts";
import { addDomain, disableDomain, enableDomain, loadDomainCatalog } from "../src/core/domains/catalog.ts";
import { checkWorkflowNodes } from "../src/core/domains/node-check.ts";
import { runArchonWorkflow } from "../src/core/domains/run.ts";
import { selectDomain } from "../src/core/domains/select.ts";
import { runDomainSessionCommand } from "../src/core/domains/session-command.ts";
import { ReflectiveLoopController } from "../src/core/reflective-loop/loop-controller.ts";
import { getReflectiveCycleTraces } from "../src/core/reflective-loop/session-trace.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { formatWorkflowCall } from "../src/core/tools/workflow-card.ts";
import type { Theme, ThemeColor } from "../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("domains 0.12.0", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	test("twenty initial domains load and four stay on", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-domains-"));
		const catalog = loadDomainCatalog(cwd);
		expect(catalog.domains).toHaveLength(20);
		const always = catalog.domains
			.filter((domain) => domain.alwaysOn)
			.map((domain) => domain.id)
			.sort();
		expect(always).toEqual(["ai", "engineering", "meta", "security"]);
		expect(() => disableDomain(cwd, "engineering")).toThrow(/cannot be disabled/);
		expect(() => disableDomain(cwd, "security")).toThrow(/cannot be disabled/);
		expect(() => disableDomain(cwd, "ai")).toThrow(/cannot be disabled/);
		expect(() => disableDomain(cwd, "meta")).toThrow(/cannot be disabled/);
	});

	test("SKILL.md is rejected and a bash workflow runs", async () => {
		expect(() => parseArchonWorkflow("name: x\ndescription: y\nnodes: []\n", "SKILL.md")).toThrow(/SKILL.md/);
		const cwd = mkdtempSync(join(tmpdir(), "trek-archon-"));
		const file = join(cwd, "fixture.yaml");
		writeFileSync(
			file,
			[
				"name: fixture",
				"description: echo a marker",
				"nodes:",
				"  - id: say",
				"    bash: echo trek-archon-ok",
				"",
			].join("\n"),
		);
		const workflow = loadArchonFile(file);
		const results = await runArchonWorkflow(workflow, cwd);
		expect(results).toEqual([{ id: "say", output: "trek-archon-ok" }]);
	});

	test("a loop is an object, and a prompt node receives the upstream output", async () => {
		expect(() =>
			parseArchonWorkflow(
				[
					"name: bad-loop",
					"description: a string is not a loop",
					"nodes:",
					"  - id: again",
					"    loop: keep going",
					"",
				].join("\n"),
			),
		).toThrow(/loop is an object/);
		const workflow = parseArchonWorkflow(
			[
				"name: chain",
				"description: two prompt steps",
				"nodes:",
				"  - id: one",
				"    prompt: Name the account in the user turn.",
				"  - id: two",
				"    prompt: Read $one.output and do not invent a side.",
				"    depends_on: [one]",
				"  - id: again",
				"    loop:",
				"      prompt: keep going",
				"      until: COMPLETE",
				"      max_iterations: 2",
				"    depends_on: [two]",
				"",
			].join("\n"),
		);
		expect(workflow.nodes[2]?.loop).toEqual({ until: "COMPLETE", maxIterations: 2 });
		const prompts: string[] = [];
		await expect(
			runArchonWorkflow(
				{ ...workflow, nodes: workflow.nodes.filter((node) => node.kind === "prompt") },
				{
					cwd: process.cwd(),
					userMessage: "account 4100",
					runPrompt: async (prompt) => {
						prompts.push(prompt);
						return prompts.length === 1 ? "account 4100" : "the side is not in the turn";
					},
				},
			),
		).resolves.toEqual([
			{ id: "one", output: "account 4100" },
			{ id: "two", output: "the side is not in the turn" },
		]);
		expect(prompts[0]).toContain("account 4100");
		expect(prompts[1]).toContain("account 4100");
		expect(prompts[1]).toContain("do not invent a side");
	});

	test("a selected finance workflow calls each prompt node", async () => {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("account 4100, March, 1200"),
			fauxAssistantMessage("the sides are not in the turn"),
			fauxAssistantMessage("the SOX control is the bank rec"),
			fauxAssistantMessage("the correcting entry is not posted"),
		]);
		await harness.session.prompt(
			"The reconciliation break for account 4100 in March is 1200. The SOX control is the bank rec.",
		);
		const replies = assistantText(harness);
		expect(replies).toContain("account 4100, March, 1200");
		expect(replies).toContain("the sides are not in the turn");
		expect(replies).toContain("the SOX control is the bank rec");
		expect(replies).toContain("the correcting entry is not posted");
		expect(replies).not.toContain("workflow check");
	});

	test("a session command uses the same store and does not run a workflow", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-slash-domains-"));
		const listed = runDomainSessionCommand(cwd, "domains", "");
		expect(listed).toMatch(/│ finance\s+│ on\s+│ control-break\s+│/);
		expect(listed).toMatch(/│ engineering\s+│ always\s+│ change-review\s+│/);
		expect(listed).toContain("Detection still chooses the workflow");
		expect(runDomainSessionCommand(cwd, "domains", "disable finance")).toMatch(
			/│ finance\s+│ off\s+│ control-break\s+│/,
		);
		const skipped = selectDomain(loadDomainCatalog(cwd), {
			task: "The reconciliation break for account 4100 in March is 1200. The SOX control is the bank rec.",
		});
		expect(skipped.domain).not.toBe("finance");
		runDomainSessionCommand(cwd, "domains", "enable finance");
		expect(loadDomainCatalog(cwd).disabled.has("finance")).toBe(false);
		expect(runDomainSessionCommand(cwd, "domains", "disable engineering")).toMatch(/cannot be disabled/);
		const shown = runDomainSessionCommand(cwd, "workflows", "show finance");
		expect(shown).toContain("finance  control-break");
		expect(shown).toMatch(/│ name-account\s+│/);
		expect(shown).toMatch(/│ propose-entry\s+│/);
		expect(shown).toContain("Do not post it.");
		expect(shown).not.toContain("name: control-break");
		expect(runDomainSessionCommand(cwd, "workflows", "run finance")).toMatch(/does not run a workflow/);
	});

	test("a node reply that invents a fact is visible, and a missing fact said to be absent is not", () => {
		const user =
			"The build failed on the adapter. The architecture violation is the layer rule. The tech debt is the empty adapter.";
		const invented = checkWorkflowNodes(user, [
			{
				id: "state-constraint",
				prompt: "State the design constraint the change must keep.",
				output: "adapters depend only on the domain layer without bypassing it",
			},
		]);
		expect(invented.map((finding) => finding.kind)).toEqual(["not-in-turn"]);
		expect(invented[0]?.detail).toContain("domain");
		const absent = checkWorkflowNodes(
			"The reconciliation break for account 4100 in March is 1200. The SOX control is the bank rec.",
			[
				{
					id: "propose-entry",
					prompt: "Propose the correcting entry in words. Do not post it.",
					output: "the sides are not in the turn",
				},
			],
		);
		expect(absent).toEqual([]);
		const skipped = checkWorkflowNodes("account 4100", [
			{ id: "name-account", prompt: "Name the account, the period, and the amount of the break.", output: "" },
		]);
		expect(skipped[0]?.kind).toBe("skipped");
	});

	test("a selected workflow shows the check on the turn and does not call a tool", async () => {
		const harness = await createHarness({ enableReflectiveLoop: true });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage("adapters depend only on the domain layer without bypassing it"),
			fauxAssistantMessage("no build was run"),
			fauxAssistantMessage("the tech debt is the empty adapter"),
			fauxAssistantMessage("refuse to edit"),
		]);
		await harness.session.prompt(
			"The build failed on the adapter. The architecture violation is the layer rule. The tech debt is the empty adapter. Do not use tools. Do not read files.",
		);
		const replies = assistantText(harness);
		expect(replies).toContain("workflow check");
		expect(replies).toContain("state-constraint: fact not in the turn");
		expect(harness.session.getWorkflowCheck()).toContain("domain");
	});

	test("untagged prompts select a domain, and a second prompt selects another", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-select-"));
		const catalog = loadDomainCatalog(cwd);
		const security = selectDomain(catalog, { task: "A secret exposed in the log and a CVE in the lockfile." });
		expect(security.domain).toBe("security");
		expect(security.workflow).toBe("exposure-check");
		expect(security.selectionReason).toBe("match");
		expect(security.nodeIds).toContain("name-asset");

		const finance = selectDomain(catalog, {
			task: "The reconciliation break is still open.",
			previous: security.yaml,
		});
		expect(finance.domain).toBe("finance");
		expect(finance.workflow).toBe("control-break");
		expect(finance.parameters.map((parameter) => parameter.name)).toContain("reconciliation break");
	});

	test("a finance turn fills account, period, amount, and control", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-fill-"));
		const catalog = loadDomainCatalog(cwd);
		const finance = selectDomain(catalog, {
			task: "The reconciliation break for account 4100 in March is 1200. The SOX control is the bank rec.",
		});
		expect(finance.domain).toBe("finance");
		expect(finance.parameters).toEqual([
			{ name: "account", kind: "number", value: "4100" },
			{ name: "period", kind: "text", value: "March" },
			{ name: "amount", kind: "number", value: "1200" },
			{ name: "control", kind: "text", value: "bank rec" },
		]);
	});

	test("the workflow call colors the title and the filled parameters", () => {
		const theme = {
			fg(color: ThemeColor, text: string) {
				return `{${color}}${text}`;
			},
			bold(text: string) {
				return text;
			},
		} as Theme;
		const painted = formatWorkflowCall(
			{
				domain: "finance",
				workflow: "control-break",
				reason: "match",
				parameters: [
					{ name: "account", kind: "number", value: "4100" },
					{ name: "control", kind: "text", value: "bank rec" },
				],
				nodes: ["name-account", "quantify-break"],
			},
			theme,
		);
		expect(painted).toContain("{success}workflow");
		expect(painted).toContain("{success}finance");
		expect(painted).toContain("{mdLink}control-break");
		expect(painted).toContain("{syntaxKeyword}account");
		expect(painted).toContain("{syntaxNumber}4100");
		expect(painted).toContain("{syntaxString}bank rec");
		expect(painted).toContain("{syntaxFunction}name-account → quantify-break");
		expect(painted).not.toContain("\u001b");
	});

	test("a disabled domain is not selected, and an added domain starts off", () => {
		const cwd = mkdtempSync(join(tmpdir(), "trek-add-"));
		disableDomain(cwd, "finance");
		const hidden = selectDomain(loadDomainCatalog(cwd), { task: "The reconciliation break is still open." });
		expect(hidden.domain).toBe("none");
		expect(hidden.workflow).toBe("none");
		expect(hidden.selectionReason).toBe("none");

		const file = join(cwd, "oxblood.yaml");
		writeFileSync(
			file,
			[
				"name: oxblood-check",
				"description: Look up the oxblood pump serial.",
				"nodes:",
				"  - id: read-serial",
				"    prompt: Read the serial on the oxblood pump.",
				"",
			].join("\n"),
		);
		addDomain(cwd, "warehouse", file);
		const before = selectDomain(loadDomainCatalog(cwd), { task: "Where is the oxblood pump serial?" });
		expect(before.domain).toBe("none");
		enableDomain(cwd, "warehouse");
		const after = selectDomain(loadDomainCatalog(cwd), { task: "Where is the oxblood pump serial?" });
		expect(after.domain).toBe("warehouse");
		expect(after.workflow).toBe("oxblood-check");
		expect(after.nodeIds).toEqual(["read-serial"]);
	});

	test("every intend cycle records domain, workflow, and selectionReason", async () => {
		const manager = SessionManager.inMemory(process.cwd());
		const controller = new ReflectiveLoopController(manager);
		const first = await controller.runPromptCycle({
			task: "A secret exposed in the log and a CVE in the lockfile.",
			cwd: process.cwd(),
			messageCount: 0,
			getMessageCount: () => 1,
			act: async () => {},
		});
		expect(first.domain).toBe("security");
		expect(first.workflow).toBe("exposure-check");
		expect(first.selectionReason).toBe("match");
		expect(first.nodeIds?.length).toBeGreaterThan(0);
		expect(first.phases.intend.summary).toMatch(/domain=security/);

		const second = await controller.runPromptCycle({
			task: "The reconciliation break is still open.",
			cwd: process.cwd(),
			messageCount: 1,
			getMessageCount: () => 2,
			act: async () => {},
		});
		expect(second.domain).toBe("finance");
		expect(second.workflow).toBe("control-break");

		const traces = getReflectiveCycleTraces(manager.getEntries());
		expect(traces.map((trace) => trace.domain)).toEqual(["security", "finance"]);
		expect(traces.every((trace) => trace.selectionReason === "match")).toBe(true);
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
