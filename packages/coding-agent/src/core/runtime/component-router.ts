/**
 * Per-component model assignment (0.9.0).
 * The role name stays Workhorse. A later Decision model, such as Jev, can fill that slot.
 */

import type { ResolvedRuntime } from "./resolve.ts";
import type { RoleSelection } from "./select-role.ts";
import { FRONTIER_COMPLEXITY_THRESHOLD } from "./select-role.ts";
import type { RouteComponent, RouteRole } from "./types.ts";

const COMPONENT_ROLE: Record<RouteComponent, RouteRole> = {
	worldModel: "planning",
	toolIntent: "tooling",
	mechanical: "workhorse",
	intend: "planning",
};

const TIER: RouteRole[] = ["workhorse", "tooling", "planning", "frontier"];

export interface ComponentRouteInput {
	component: RouteComponent;
	resolved: ResolvedRuntime;
	complexity?: number;
	retries?: number;
	depth?: number;
	/** Fraction of the step budget still unused. Below 0.2 de-escalates to Workhorse. */
	budgetRemaining?: number;
	overrides?: Partial<Record<RouteComponent, RouteRole>>;
}

export function routeComponent(input: ComponentRouteInput): RoleSelection {
	const override = input.overrides?.[input.component];
	if (override) {
		return assign(input.resolved, override, `static override pins ${input.component} to ${override}`);
	}

	const base = COMPONENT_ROLE[input.component];
	const complexity = input.complexity ?? 0;
	const retries = input.retries ?? 0;
	const depth = input.depth ?? 0;
	const lowBudget = input.budgetRemaining !== undefined && input.budgetRemaining < 0.2;
	const heavy = complexity > FRONTIER_COMPLEXITY_THRESHOLD || (input.component === "intend" && depth === 0);

	if (heavy) {
		return assign(input.resolved, escalationTarget(input.resolved), escalationReason(input));
	}
	if (retries >= 2) {
		return assign(
			input.resolved,
			nextTier(base, input.resolved),
			`${input.component} failed ${retries} times; next tier after ${base}`,
		);
	}
	if (lowBudget || input.component === "mechanical") {
		return assign(input.resolved, "workhorse", workhorseReason(input.component, lowBudget));
	}
	return assign(input.resolved, base, `${input.component} uses ${base}`);
}

function escalationTarget(resolved: ResolvedRuntime): RouteRole {
	if (resolved.effectiveMode === "hybrid" && resolved.roles.frontier) {
		return "frontier";
	}
	if (resolved.effectiveMode === "api") {
		return "frontier";
	}
	return "planning";
}

function escalationReason(input: ComponentRouteInput): string {
	if (input.component === "intend" && (input.depth ?? 0) === 0) {
		return "depth-0 Intend escalates";
	}
	return `complexity ${input.complexity ?? 0} escalates`;
}

function workhorseReason(component: RouteComponent, lowBudget: boolean): string {
	if (lowBudget) {
		return `low remaining budget uses Workhorse for ${component}`;
	}
	return `${component} uses Workhorse`;
}

function nextTier(role: RouteRole, resolved: ResolvedRuntime): RouteRole {
	const index = TIER.indexOf(role);
	for (let cursor = index + 1; cursor < TIER.length; cursor++) {
		const candidate = TIER[cursor];
		if (candidate && resolved.roles[candidate]) {
			return candidate;
		}
	}
	return role;
}

function assign(resolved: ResolvedRuntime, role: RouteRole, reason: string): RoleSelection {
	if (resolved.effectiveMode === "api") {
		const frontier = resolved.roles.frontier;
		if (!frontier) {
			throw new Error("API mode has no frontier model.");
		}
		return {
			role: "frontier",
			source: frontier.source,
			modelId: frontier.id,
			...(frontier.provider ? { provider: frontier.provider } : {}),
			thinking: frontier.thinking,
			reason: `api mode records the session model as frontier (${reason})`,
		};
	}

	const assignment = resolved.roles[role] ?? resolved.roles.planning ?? resolved.roles.workhorse;
	if (!assignment) {
		throw new Error(`Role ${role} is not assigned.`);
	}
	const used = resolved.roles[role] ? role : assignment === resolved.roles.planning ? "planning" : "workhorse";
	return {
		role: used,
		source: assignment.source,
		modelId: assignment.id,
		...(assignment.provider ? { provider: assignment.provider } : {}),
		thinking: assignment.thinking,
		reason: resolved.roles[role] ? reason : `${reason}; ${role} is missing, using ${used}`,
	};
}
