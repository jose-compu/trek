import { describe, expect, test } from "vitest";
import { formatLessonNotice, lessonNoticeTitle } from "../src/core/reflective-loop/lesson-title.ts";

describe("lessonNoticeTitle", () => {
	test("title-cases the rule and stays short", () => {
		expect(lessonNoticeTitle({ rule: "Avoid verbose output in bash traces." })).toBe(
			"Avoid Verbose Output In Bash Traces",
		);
	});

	test("falls back through trigger then mistake", () => {
		expect(lessonNoticeTitle({ trigger: "choosing a deploy target" })).toBe("Choosing A Deploy Target");
		expect(lessonNoticeTitle({ mistake: "used production" })).toBe("Used Production");
	});

	test("returns empty when no usable text exists", () => {
		expect(lessonNoticeTitle({})).toBe("");
	});
});

describe("formatLessonNotice", () => {
	test("includes id and title", () => {
		expect(formatLessonNotice([{ id: "project:1020", title: "Avoid Verbose Output" }])).toBe(
			"lesson project:1020 Avoid Verbose Output",
		);
	});

	test("omits a missing title", () => {
		expect(formatLessonNotice([{ id: "project:1020" }])).toBe("lesson project:1020");
	});
});
