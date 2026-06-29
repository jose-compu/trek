import { describe, expect, test } from "vitest";
import {
	type ChangelogEntry,
	compareVersions,
	filterEntriesUpToVersion,
	getNewEntries,
	parseVersionString,
} from "../src/utils/changelog.ts";

function entry(version: string, content = version): ChangelogEntry {
	const parsed = parseVersionString(version);
	return { ...parsed, content };
}

describe("changelog", () => {
	test("filterEntriesUpToVersion excludes Pi 0.10.x when running Trek 0.2.0", () => {
		const entries = [entry("0.10.2"), entry("0.2.0"), entry("0.1.0")];
		const filtered = filterEntriesUpToVersion(entries, "0.2.0");
		expect(filtered.map((e) => `${e.major}.${e.minor}.${e.patch}`)).toEqual(["0.2.0", "0.1.0"]);
	});

	test("getNewEntries after filter only returns Trek releases since last seen", () => {
		const entries = filterEntriesUpToVersion([entry("0.10.2"), entry("0.2.0"), entry("0.1.0")], "0.2.0");
		const newEntries = getNewEntries(entries, "0.1.0");
		expect(newEntries.map((e) => `${e.major}.${e.minor}.${e.patch}`)).toEqual(["0.2.0"]);
	});

	test("compareVersions treats 0.10 as greater than 0.2", () => {
		expect(compareVersions(entry("0.10.2"), entry("0.2.0"))).toBeGreaterThan(0);
	});
});
