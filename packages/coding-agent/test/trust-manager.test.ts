import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasProjectTrustInputs, ProjectTrustStore } from "../src/core/trust-manager.ts";

describe("project trust", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("detects a project config directory and remembers a decision", () => {
		const root = mkdtempSync(join(tmpdir(), "trek-trust-"));
		dirs.push(root);
		const project = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(join(project, ".trek"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });

		expect(hasProjectTrustInputs(project)).toBe(true);

		const store = new ProjectTrustStore(agentDir);
		expect(store.get(project)).toBeNull();
		store.set(project, false);
		expect(store.get(project)).toBe(false);
		chmodSync(join(agentDir, "trust.json"), 0o600);
	});

	it("does not treat an empty directory as a trust input", () => {
		const root = mkdtempSync(join(tmpdir(), "trek-trust-empty-"));
		dirs.push(root);
		const project = join(root, "empty");
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, "README.txt"), "plain\n");
		expect(hasProjectTrustInputs(project)).toBe(false);
	});
});
