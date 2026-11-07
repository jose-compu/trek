/**
 * Per-component model assignment (0.9.0).
 * Ladder: Workhorse → Planning → Frontier. Tooling is opt-in via a YAML pin or delegate.
 */

import { frontierBound, nextLadderRole, startLadderRole } from "./escalate.ts";
import type { ResolvedRuntime } from "./resolve.ts";
import type { RoleSelection } from "./select-role.ts";
import { FRONTIER_COMPLEXITY_THRESHOLD } from "./select-role.ts";
import { type RouteComponent, type RouteRole, roleThinkingEnabled } from "./types.ts";

const COMPONENT_ROLE: Record<RouteComponent, RouteRole> = {
	worldModel: "planning",
	toolIntent: "workhorse",
	mechanical: "workhorse",
	intend: "planning",
};

/** Climb order. Tooling is not a rung; a YAML pin may still name it. */
const TIER: RouteRole[] = ["workhorse", "planning", "frontier"];

export interface ComponentRouteInput {
	component: RouteComponent;
	resolved: ResolvedRuntime;
	complexity?: number;
	retries?: number;
	depth?: number;
	/** Fraction of the step budget still unused. Below 0.2 stays on Tooling/Workhorse. */
	budgetRemaining?: number;
	/** Force a ladder floor (from prior elevation). */
	minRole?: RouteRole;
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
	const lowBudget = input.budgetRemaining !== undefined && input.budgetRemaining < 0.2;
	const heavy = complexity > FRONTIER_COMPLEXITY_THRESHOLD;

	if (heavy) {
		return assign(input.resolved, escalationTarget(input.resolved), escalationReason(input));
	}
	if (retries >= 2) {
		const after = nextTier(base, input.resolved);
		return assign(input.resolved, after, `${input.component} failed ${retries} times; next tier after ${base}`);
	}
	if (lowBudget || input.component === "mechanical") {
		const role = input.minRole ?? "workhorse";
		const used = floorRole(role, input.minRole, input.resolved);
		return assign(input.resolved, used, workhorseReason(input.component, lowBudget, used));
	}
	const floored = floorRole(base, input.minRole, input.resolved);
	return assign(input.resolved, floored, `${input.component} uses ${floored}`);
}

function floorRole(base: RouteRole, minRole: RouteRole | undefined, resolved: ResolvedRuntime): RouteRole {
	if (!minRole) {
		return resolveAvailable(base, resolved);
	}
	if (minRole === "tooling") {
		return resolveAvailable("tooling", resolved);
	}
	const climbBase = base === "tooling" ? "workhorse" : base;
	const baseIndex = TIER.indexOf(climbBase);
	const minIndex = TIER.indexOf(minRole);
	const pick = minIndex > baseIndex ? minRole : climbBase;
	return resolveAvailable(pick, resolved);
}

function resolveAvailable(role: RouteRole, resolved: ResolvedRuntime): RouteRole {
	if (role === "tooling") {
		if (resolved.roles.tooling) {
			return "tooling";
		}
		return startLadderRole(resolved);
	}
	if (role === "frontier") {
		if (frontierBound(resolved)) {
			return "frontier";
		}
		return resolveAvailable("planning", resolved);
	}
	if (resolved.roles[role]) {
		return role;
	}
	const next = nextLadderRole(role, resolved);
	if (next) {
		return next;
	}
	return startLadderRole(resolved);
}

function escalationTarget(resolved: ResolvedRuntime): RouteRole {
	if (frontierBound(resolved) || resolved.effectiveMode === "api") {
		return "frontier";
	}
	return "planning";
}

function escalationReason(input: ComponentRouteInput): string {
	return `complexity ${input.complexity ?? 0} escalates`;
}

function workhorseReason(component: RouteComponent, lowBudget: boolean, role: RouteRole): string {
	if (lowBudget) {
		return `low remaining budget uses ${role} for ${component}`;
	}
	return `${component} uses ${role}`;
}

function nextTier(role: RouteRole, resolved: ResolvedRuntime): RouteRole {
	if (role === "tooling") {
		return nextLadderRole("workhorse", resolved) ?? startLadderRole(resolved);
	}
	const next = nextLadderRole(role, resolved);
	return next ?? role;
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
			thinking: roleThinkingEnabled(frontier.thinking),
			reason: `api mode records the session model as frontier (${reason})`,
		};
	}

	const used = resolveAvailable(role, resolved);
	const assignment = resolved.roles[used];
	if (!assignment) {
		throw new Error(`Role ${used} is not assigned.`);
	}
	return {
		role: used,
		source: assignment.source,
		modelId: assignment.id,
		...(assignment.provider ? { provider: assignment.provider } : {}),
		thinking: roleThinkingEnabled(assignment.thinking),
		reason: used === role ? reason : `${reason}; ${role} unavailable, using ${used}`,
	};
}
