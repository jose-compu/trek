import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewPiVersion,
	comparePackageVersions,
	getLatestPiRelease,
	getLatestPiVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";

const originalSkipVersionCheck = process.env.PI_SKIP_VERSION_CHECK;
const originalTrekSkipVersionCheck = process.env.TREK_SKIP_VERSION_CHECK;
const originalTrekLatestVersionUrl = process.env.TREK_LATEST_VERSION_URL;
const originalOffline = process.env.PI_OFFLINE;

afterEach(() => {
	vi.unstubAllGlobals();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.PI_SKIP_VERSION_CHECK;
	} else {
		process.env.PI_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
	if (originalTrekSkipVersionCheck === undefined) {
		delete process.env.TREK_SKIP_VERSION_CHECK;
	} else {
		process.env.TREK_SKIP_VERSION_CHECK = originalTrekSkipVersionCheck;
	}
	if (originalTrekLatestVersionUrl === undefined) {
		delete process.env.TREK_LATEST_VERSION_URL;
	} else {
		process.env.TREK_LATEST_VERSION_URL = originalTrekLatestVersionUrl;
	}
	if (originalOffline === undefined) {
		delete process.env.PI_OFFLINE;
	} else {
		process.env.PI_OFFLINE = originalOffline;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		process.env.TREK_LATEST_VERSION_URL = "https://example.test/api/latest-version";
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.3", packageName: "@trek/coding-agent" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewPiVersion("1.2.2")).resolves.toEqual({
			version: "1.2.3",
			packageName: "@trek/coding-agent",
		});
	});

	it("uses the configured Trek version check api with a trek user agent", async () => {
		process.env.TREK_LATEST_VERSION_URL = "https://example.test/api/latest-version";
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4", packageName: "@trek/coding-agent" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://example.test/api/latest-version",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^trek\/1\.2\.3 /),
					accept: "application/json",
				}),
			}),
		);
	});

	it("returns the active package metadata from the version check api", async () => {
		process.env.TREK_LATEST_VERSION_URL = "https://example.test/api/latest-version";
		const fetchMock = vi.fn(async () =>
			Response.json({
				packageName: "@trek/coding-agent",
				version: "1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("1.2.3")).resolves.toEqual({
			packageName: "@trek/coding-agent",
			version: "1.2.4",
		});
	});

	it("returns update notes from the version check api", async () => {
		process.env.TREK_LATEST_VERSION_URL = "https://example.test/api/latest-version";
		const fetchMock = vi.fn(async () => Response.json({ note: " **Read this** ", version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("1.2.3")).resolves.toEqual({ note: "**Read this**", version: "1.2.4" });
	});

	it("skips upstream Pi version checks for Trek by default", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("0.1.0")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips api calls when version checks are disabled", async () => {
		process.env.TREK_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
