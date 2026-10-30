/**
 * Lesson promotion (L3 to L2, L2 to L1) uses Frontier when assigned, else Planning.
 */

import type { ResolvedRuntime } from "./resolve.ts";
import type { RoleAssignment } from "./types.ts";

export interface PromotionRole {
	role: "frontier" | "planning";
	assignment: RoleAssignment;
	reason: string;
}

export function promotionRole(resolved: ResolvedRuntime): PromotionRole | undefined {
	const frontier = resolved.roles.frontier;
	if (frontier) return { role: "frontier", assignment: frontier, reason: "promotion uses Frontier" };
	const planning = resolved.roles.planning;
	if (planning)
		return { role: "planning", assignment: planning, reason: "Frontier is not assigned; promotion uses Planning" };
	return undefined;
}

export const NO_PROMOTION_MODEL = "No Planning or Frontier model is assigned for promotion.";
