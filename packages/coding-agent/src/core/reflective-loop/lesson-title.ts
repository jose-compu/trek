const TITLE_MAX = 40;
const TITLE_WORDS = 6;

/** Brief title from a stored lesson. Empty when there is nothing usable. */
export function lessonNoticeTitle(lesson: { rule?: string; trigger?: string; mistake?: string }): string {
	const src = (lesson.rule || lesson.trigger || lesson.mistake || "").replace(/\s+/g, " ").trim();
	if (!src) {
		return "";
	}
	const words = src
		.replace(/[_./]+/g, " ")
		.replace(/[^A-Za-z0-9\s-]/g, "")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, TITLE_WORDS);
	if (words.length === 0) {
		return "";
	}
	const titled = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
	if (titled.length <= TITLE_MAX) {
		return titled;
	}
	return `${titled.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export function formatLessonNotice(entries: readonly { id: string; title?: string }[]): string {
	if (entries.length === 0) {
		return "";
	}
	if (entries.length === 1) {
		const entry = entries[0];
		const title = entry?.title?.trim();
		const id = entry?.id ?? "";
		return title ? `lesson ${id} ${title}` : `lesson ${id}`;
	}
	return `lessons ${entries.map((entry) => entry.id).join(", ")}`;
}
