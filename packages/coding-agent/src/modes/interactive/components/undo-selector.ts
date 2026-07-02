import { basename } from "node:path";
import { Container, type SelectItem, SelectList, type SelectListLayoutOptions } from "@trek/tui";
import type { BatchSummary } from "../../../core/edit-checkpoints/index.ts";
import { getSelectListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

const UNDO_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 16,
	maxPrimaryColumnWidth: 40,
};

const MAX_VISIBLE_ITEMS = 8;

function describeBatch(batch: BatchSummary, index: number): string {
	const files = batch.paths.map((p) => basename(p));
	const fileList = files.slice(0, 3).join(", ") + (files.length > 3 ? `, +${files.length - 3} more` : "");
	const scope = index === 0 ? "last batch" : `reverts ${index + 1} batches`;
	return `${batch.fileCount} file${batch.fileCount === 1 ? "" : "s"} (${fileList}) — ${scope}`;
}

/**
 * Undo selector (issue #16): pick an edit batch / prompt `#M` to revert back to.
 * Selecting an entry undoes that prompt's batch and everything after it.
 */
export class UndoSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(batches: BatchSummary[], onSelect: (promptNumber: number) => void, onCancel: () => void) {
		super();

		// Batches arrive newest first; selecting entry i means undoToPrompt(batch.promptNumber).
		const items: SelectItem[] = batches.map((batch, index) => ({
			value: String(batch.promptNumber),
			label: `Undo to ${batch.promptId}`,
			description: describeBatch(batch, index),
		}));

		this.addChild(new DynamicBorder());
		this.selectList = new SelectList(
			items,
			Math.min(items.length, MAX_VISIBLE_ITEMS),
			getSelectListTheme(),
			UNDO_SELECT_LIST_LAYOUT,
		);
		this.selectList.onSelect = (item) => {
			onSelect(Number(item.value));
		};
		this.selectList.onCancel = () => {
			onCancel();
		};
		this.addChild(this.selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
