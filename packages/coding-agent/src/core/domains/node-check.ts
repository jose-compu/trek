/**
 * Compare each node reply with the user turn and that node's prompt.
 * A miss is text. This check does not post, edit, or run a tool.
 */

import { stripHonestyFooter } from "../honesty/index.ts";

export interface WorkflowNodeCheck {
	id: string;
	prompt: string;
	output: string;
	/** Replies from depends_on. A later node may use them. */
	upstream?: string;
}

export interface WorkflowNodeFinding {
	id: string;
	kind: "skipped" | "not-in-turn";
	detail: string;
}

const ABSENCE =
	/not in the turn|not in this turn|none has been run|no build|there is none|not stated|not named|absent from|not posted|do not post/i;
const WORD = /[a-z0-9]+/g;

export function checkWorkflowNodes(userMessage: string, nodes: readonly WorkflowNodeCheck[]): WorkflowNodeFinding[] {
	const findings: WorkflowNodeFinding[] = [];
	for (const node of nodes) {
		const output = stripHonestyFooter(node.output).trim();
		if (!output) {
			findings.push({ id: node.id, kind: "skipped", detail: "empty" });
			continue;
		}
		const ground = `${userMessage}\n${node.prompt}\n${node.upstream ?? ""}`.toLowerCase();
		const groundWords = new Set(ground.match(WORD) ?? []);
		const ungrounded = new Set<string>();
		let sawSubstance = false;
		for (const sentence of output.split(/\n+|(?<=[.!?])\s+/)) {
			if (ABSENCE.test(sentence)) {
				sawSubstance = true;
				continue;
			}
			for (const word of sentence.toLowerCase().match(WORD) ?? []) {
				if (/^\d{2,}$/.test(word)) {
					if (!ground.includes(word)) ungrounded.add(word);
					else sawSubstance = true;
					continue;
				}
				if (word.length < 5) continue;
				if (isGrounded(word, groundWords)) sawSubstance = true;
				else ungrounded.add(word);
			}
		}
		if (ungrounded.size > 0) {
			findings.push({
				id: node.id,
				kind: "not-in-turn",
				detail: [...ungrounded].slice(0, 6).join(", "),
			});
		} else if (!sawSubstance) {
			findings.push({ id: node.id, kind: "skipped", detail: "no fact from the turn" });
		}
	}
	return findings;
}

export function formatWorkflowCheck(findings: readonly WorkflowNodeFinding[]): string {
	const lines = ["workflow check"];
	for (const finding of findings) {
		lines.push(
			finding.kind === "skipped"
				? `${finding.id}: skipped`
				: `${finding.id}: fact not in the turn (${finding.detail})`,
		);
	}
	return lines.join("\n");
}

function isGrounded(word: string, groundWords: Set<string>): boolean {
	if (groundWords.has(word)) return true;
	for (const ground of groundWords) {
		if (ground.length >= 4 && (word.startsWith(ground) || ground.startsWith(word))) return true;
	}
	return false;
}
