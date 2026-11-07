/**
 * Route / escalate / cost in session JSONL. `trek trace` includes source.
 */

import type { RoleAssignment, RoleSource, RuntimeRole } from "./types.ts";

export const LAYER_ROUTE_CUSTOM_TYPE = "trek:layer_route";

export const LAYER_ROUTE_ACTIONS = ["escalate", "descalate", "route", "delegate", "verify"] as const;
export type LayerRouteAction = (typeof LAYER_ROUTE_ACTIONS)[number];

export interface LayerRouteTrace {
	from: string;
	to: string;
	action: LayerRouteAction;
	source?: RoleSource;
	provider?: string;
	modelId?: string;
	cost?: number;
	why?: string;
}

export function layerRouteTrace(
	from: string,
	to: string,
	action: LayerRouteAction,
	role: RoleAssignment | undefined,
	why?: string,
	cost?: number,
): LayerRouteTrace {
	const trace: LayerRouteTrace = { from, to, action };
	if (role?.source) {
		trace.source = role.source;
	}
	if (role?.provider) {
		trace.provider = role.provider;
	}
	if (role?.id) {
		trace.modelId = role.id;
	}
	if (why?.trim()) {
		trace.why = why.trim().slice(0, 160);
	}
	if (cost !== undefined) {
		trace.cost = cost;
	}
	return trace;
}

export function formatLayerRoute(trace: LayerRouteTrace): string {
	const source = trace.source ? ` source ${trace.source}` : "";
	const provider = trace.provider ? ` provider ${trace.provider}` : "";
	const model = trace.modelId ? ` ${trace.modelId}` : "";
	return `${trace.action} ${trace.from} → ${trace.to}${source}${provider}${model}`;
}

/** Writer (Workhorse) and verifier must be different providers when both are bound. */
export function mixVendorVerifier(roles: Partial<Record<RuntimeRole, RoleAssignment>>): boolean {
	const writer = roles.workhorse;
	const verifier = roles.verifier;
	if (!writer || !verifier) {
		return false;
	}
	if (!writer.provider || !verifier.provider) {
		return false;
	}
	return writer.provider !== verifier.provider;
}

export function mixVendorVerifierError(roles: Partial<Record<RuntimeRole, RoleAssignment>>): string | undefined {
	const writer = roles.workhorse;
	const verifier = roles.verifier;
	if (!writer || !verifier || !writer.provider || !verifier.provider) {
		return undefined;
	}
	if (writer.provider === verifier.provider) {
		return "Verifier must use a different provider than Workhorse.";
	}
	return undefined;
}

export function isLayerRouteEntry(entry: { type?: string; customType?: string }): boolean {
	return entry.type === "custom" && entry.customType === LAYER_ROUTE_CUSTOM_TYPE;
}
