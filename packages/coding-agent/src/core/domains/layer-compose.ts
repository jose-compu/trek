/**
 * Compose a domain Archon DAG with a layer-* DAG on the same turn (0.18-A).
 * Detection still chooses the domain. Layering wraps how roles cooperate.
 */

import type { LayeringMode } from "../runtime/types.ts";
import { findLayerWorkflow, loadLayerWorkflows } from "./catalog.ts";
import type { DomainSelection } from "./select.ts";

const LAYER_HINTS: Record<string, string[]> = {
	"layer-escalate": ["escalate", "climb", "handoff"],
	"layer-tool-runners": ["grep", "search", "logs", "fetch"],
	"layer-scripts": ["format json", "rename the symbol", "sed"],
	"layer-route": ["route to scripts", "scripts or workhorse"],
	"layer-consult": ["consult frontier", "frontier consult"],
	"layer-verify": ["verifier", "verify the diff"],
	"layer-ask-human": ["ask human", "ask the user"],
	"layer-budget-stop": ["budget stop", "circuit breaker"],
	"layer-cooldown": ["cooldown"],
	"layer-descalate": ["descalate", "drop to workhorse"],
	"layer-draft-review": ["draft review"],
	"layer-hypotheses": ["hypotheses"],
	"layer-think-brief": ["thinking briefly", "think briefly"],
	"layer-topic-reset": ["new topic", "topic reset"],
};

export function selectLayerWorkflow(layering: LayeringMode, task: string): string {
	if (layering === "single") {
		return "none";
	}
	const haystack = task.toLowerCase();
	let best: { name: string; score: number; weight: number } | undefined;
	for (const workflow of loadLayerWorkflows()) {
		const hints = LAYER_HINTS[workflow.name] ?? [workflow.name.replace(/^layer-/, "").replace(/-/g, " ")];
		let score = 0;
		let weight = 0;
		for (const hint of hints) {
			if (hint.length > 0 && haystack.includes(hint)) {
				score += 1;
				weight += hint.length;
			}
		}
		if (score === 0) {
			continue;
		}
		if (
			!best ||
			score > best.score ||
			(score === best.score && weight > best.weight) ||
			(score === best.score && weight === best.weight && workflow.name < best.name)
		) {
			best = { name: workflow.name, score, weight };
		}
	}
	return best?.name ?? "none";
}

export function attachLayerWorkflow(selection: DomainSelection, layering: LayeringMode, task: string): DomainSelection {
	return { ...selection, layer_workflow: selectLayerWorkflow(layering, task) };
}

/** Tooling runners see the selected domain workflow, not layer-* meta files. */
export function toolingWorkflowView(selection: DomainSelection): { domain: string; workflow: string } {
	const workflow = selection.workflow.startsWith("layer-") ? "none" : selection.workflow;
	return { domain: selection.domain, workflow };
}

export function layerWorkflowOrNone(name: string): string {
	if (name === "none" || name.length === 0) {
		return "none";
	}
	return findLayerWorkflow(name) ? name : "none";
}
