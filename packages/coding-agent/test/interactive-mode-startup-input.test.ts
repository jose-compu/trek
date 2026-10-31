import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	flushPendingBashComponents: () => void;
	showWorkingNow: () => void;
	showSubmittedPrompt: (text: string) => void;
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InputContext = {
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InteractiveModePrivate = {
	setupEditorSubmitHandler(this: SubmitContext): void;
	getUserInput(this: InputContext): Promise<string>;
	consumeEarlyPrompt(this: EarlyPromptContext, text: string): boolean;
};

type EarlyPromptContext = {
	earlyPrompt?: { text: string; spacer?: object; component: object };
	chatContainer: {
		children: object[];
		removeChild(component: object): void;
	};
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	return {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
		},
		flushPendingBashComponents: vi.fn(),
		showWorkingNow: vi.fn(),
		showSubmittedPrompt: vi.fn(),
		pendingUserInputs: [],
	};
}

describe("InteractiveMode startup input", () => {
	it("queues a normal prompt submitted before the input callback is installed", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" early prompt ");

		expect(context.pendingUserInputs).toEqual(["early prompt"]);
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.showWorkingNow).toHaveBeenCalledTimes(1);
		expect(context.showSubmittedPrompt).toHaveBeenCalledWith("early prompt");
		expect(context.editor.addToHistory).toHaveBeenCalledWith("early prompt");
	});

	it("returns queued startup input before installing a new input callback", async () => {
		const context: InputContext = {
			pendingUserInputs: ["queued prompt"],
		};

		await expect(interactiveModePrototype.getUserInput.call(context)).resolves.toBe("queued prompt");
		expect(context.onInputCallback).toBeUndefined();
		expect(context.pendingUserInputs).toEqual([]);
	});

	it("keeps the prompt painted on Enter when the stored text matches", () => {
		const component = { id: "prompt" };
		const spacer = { id: "spacer" };
		const children: object[] = [spacer, component];
		const context: EarlyPromptContext = {
			earlyPrompt: { text: "Name the reconciliation break.", spacer, component },
			chatContainer: {
				children,
				removeChild(child) {
					const index = children.indexOf(child);
					if (index !== -1) children.splice(index, 1);
				},
			},
		};

		expect(interactiveModePrototype.consumeEarlyPrompt.call(context, "Name the reconciliation break.")).toBe(true);
		expect(children).toEqual([spacer, component]);
		expect(context.earlyPrompt).toBeUndefined();
	});

	it("replaces the painted prompt when the stored text was expanded", () => {
		const component = { id: "prompt" };
		const spacer = { id: "spacer" };
		const children: object[] = [spacer, component];
		const context: EarlyPromptContext = {
			earlyPrompt: { text: "/skill:close", spacer, component },
			chatContainer: {
				children,
				removeChild(child) {
					const index = children.indexOf(child);
					if (index !== -1) children.splice(index, 1);
				},
			},
		};

		expect(interactiveModePrototype.consumeEarlyPrompt.call(context, "<skill>close</skill>")).toBe(false);
		expect(children).toEqual([]);
	});
});
