import { describe, expect, test } from "vitest";
import { buildSeatbeltProfile, wrapCommandWithSandbox } from "../src/core/safety/index.ts";

describe("sandbox execution (#10)", () => {
	test("Seatbelt profile denies network and restricts writes to cwd", () => {
		const profile = buildSeatbeltProfile("/work/project");
		expect(profile).toMatch(/\(deny network-outbound/);
		expect(profile).toMatch(/\(deny file-write\*\)/);
		expect(profile).toContain('(subpath "/work/project")');
	});

	test("wrap returns original command with a notice when sandbox is unavailable", () => {
		if (process.platform === "darwin") {
			// On macOS sandbox-exec is typically present; only assert the wrapped shape.
			const result = wrapCommandWithSandbox("echo hi", "/tmp");
			if (result.sandboxed) {
				expect(result.command).toMatch(/^sandbox-exec -p /);
				expect(result.command).toContain("echo hi");
			} else {
				expect(result.command).toBe("echo hi");
				expect(result.notice).toBeTruthy();
			}
			return;
		}
		const result = wrapCommandWithSandbox("echo hi", "/tmp");
		expect(result.sandboxed).toBe(false);
		expect(result.command).toBe("echo hi");
		expect(result.notice).toMatch(/not supported/i);
	});
});
