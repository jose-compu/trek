import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadArchonFile, parseArchonWorkflow } from "../src/core/domains/archon.ts";
import { addDomain, disableDomain, enableDomain, loadDomainCatalog } from "../src/core/domains/catalog.ts";
import { runArchonWorkflow } from "../src/core/domains/run.ts";
import { selectDomain } from "../src/core/domains/select.ts";
import { ReflectiveLoopController } from "../src/core/reflective-loop/loop-controller.ts";
import { getReflectiveCycleTraces } from "../src/core/reflective-loop/session-trace.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { formatWorkflowCall } from "../src/core/tools/workflow-card.ts";
import type { Theme, ThemeColor } from "../src/modes/interactive/theme/theme.ts";

describe("domains 0.12.0", () => {
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
