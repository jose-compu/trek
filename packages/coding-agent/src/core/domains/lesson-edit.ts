/**
 * Natural-language prompts that add or remove lesson categories / learning types.
 */

export interface LessonTypeEditRequest {
	kind: "add-category" | "remove-category";
	domain: string;
	category: string;
}

const ID = "([a-z][a-z0-9_-]{0,60})";
const NAME = "([a-z][a-z0-9_-]{0,60})";

const ADD = new RegExp(
	`^(?:please\\s+)?(?:add|create)\\s+(?:a\\s+)?(?:new\\s+)?(?:lesson\\s+)?(?:category|type|learning\\s+type)\\s+${NAME}\\s+(?:to|for|on)\\s+(?:the\\s+)?${ID}\\b`,
	"i",
);
const REMOVE = new RegExp(
	`^(?:please\\s+)?(?:remove|delete)\\s+(?:the\\s+)?(?:lesson\\s+)?(?:category|type|learning\\s+type)\\s+${NAME}\\s+(?:from|on)\\s+(?:the\\s+)?${ID}\\b`,
	"i",
);

export function parseLessonTypeEdit(text: string): LessonTypeEditRequest | undefined {
	const source = text.trim();
	const remove = REMOVE.exec(source);
	if (remove?.[1] && remove[2]) {
		return {
			kind: "remove-category",
			category: remove[1].toLowerCase(),
			domain: remove[2].toLowerCase(),
		};
	}
	const add = ADD.exec(source);
	if (add?.[1] && add[2]) {
		return {
			kind: "add-category",
			category: add[1].toLowerCase(),
			domain: add[2].toLowerCase(),
		};
	}
	return undefined;
}

export function lessonTypeEditCommand(request: LessonTypeEditRequest): string {
	const action = request.kind === "add-category" ? "add" : "remove";
	return `edit ${request.domain} categories ${action} ${request.category}`;
}
