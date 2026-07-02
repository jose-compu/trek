/**
 * Sandbox execution for generated code (issue #10, SPECS_SAFETY_HARNESS §13 item 5).
 *
 * v1 wraps bash commands with an OS-level sandbox profile, following the Pi sandbox
 * extension pattern (examples/extensions/sandbox) but with zero extra dependencies:
 * - macOS: `sandbox-exec` with a generated Seatbelt profile — writes restricted to
 *   the working directory and temp dirs, outbound network denied.
 * - other platforms: unavailable; callers keep running unsandboxed and surface a notice.
 *
 * Heavier isolation (bubblewrap, @anthropic-ai/sandbox-runtime) stays in the extension.
 */

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

export interface SandboxWrapResult {
	command: string;
	sandboxed: boolean;
	/** Human-readable note when the command could not be sandboxed. */
	notice?: string;
}

let sandboxExecAvailable: boolean | undefined;

/** Whether OS-level sandboxing is available on this machine. */
export function isSandboxAvailable(): boolean {
	if (process.platform !== "darwin") {
		return false;
	}
	if (sandboxExecAvailable === undefined) {
		try {
			execFileSync("which", ["sandbox-exec"], { stdio: "ignore" });
			sandboxExecAvailable = true;
		} catch {
			sandboxExecAvailable = false;
		}
	}
	return sandboxExecAvailable;
}

/** Test seam: reset the cached sandbox-exec availability probe. */
export function resetSandboxAvailabilityCache(): void {
	sandboxExecAvailable = undefined;
}

function escapeProfilePath(path: string): string {
	return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build a Seatbelt profile: default-allow, but deny outbound network and restrict
 * file writes to the working directory, temp locations, and /dev/null.
 */
export function buildSeatbeltProfile(cwd: string): string {
	const writable = [cwd, tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];
	const writeRules = writable.map((p) => `(subpath "${escapeProfilePath(p)}")`).join("\n    ");
	return `(version 1)
(allow default)
(deny network-outbound (remote ip "*:*"))
(deny file-write*)
(allow file-write*
    ${writeRules}
    (literal "/dev/null")
    (literal "/dev/stdout")
    (literal "/dev/stderr")
    (regex #"^/dev/tty"))`;
}

function escapeSingleQuotes(text: string): string {
	return text.replace(/'/g, "'\\''");
}

/**
 * Wrap a bash command so it runs inside the OS sandbox. When sandboxing is not
 * available the original command is returned with `sandboxed: false` and a notice.
 */
export function wrapCommandWithSandbox(command: string, cwd: string): SandboxWrapResult {
	if (!isSandboxAvailable()) {
		return {
			command,
			sandboxed: false,
			notice:
				process.platform === "darwin"
					? "sandbox-exec not found; command ran unsandboxed."
					: `OS sandbox not supported on ${process.platform}; command ran unsandboxed.`,
		};
	}
	const profile = buildSeatbeltProfile(cwd);
	const wrapped = `sandbox-exec -p '${escapeSingleQuotes(profile)}' bash -c '${escapeSingleQuotes(command)}'`;
	return { command: wrapped, sandboxed: true };
}
