/** Same Grok id on every role, so a score gap is the layering machinery. */

export const BENCH_MODEL_ID = "grok-4.3";

/**
 * Fast floor versus a stronger climb. Used by the rules-win case.
 * This key has no grok-4.1-fast. The non-reasoning 4.20 SKU is the fast floor.
 */
export const FLOOR_MODEL_ID = "grok-4.20-0309-non-reasoning";
export const CLIMB_MODEL_ID = "grok-4.7";

export type BenchLever = "single" | "auto";
export type BenchProfile = "same" | "climb" | "fan";

function role(id: string, thinking: "off" | "brief"): string {
	return `    source: api
    id: ${id}
    thinking: ${thinking}
    provider: xai`;
}

export function leverModelsYaml(lever: BenchLever, profile: BenchProfile = "same"): string {
	if (profile === "fan") {
		const high = role(CLIMB_MODEL_ID, "brief");
		const floor = role(FLOOR_MODEL_ID, "off");
		if (lever === "single") {
			return `hierarchy:
  mode: api
  suite: lfm
  quant: q4_k_m
  layering: single
roles:
  decision:
${high}
`;
		}
		return `hierarchy:
  mode: api
  suite: lfm
  quant: q4_k_m
  layering: auto
roles:
  decision:
${floor}
  tooling:
${floor}
  workhorse:
${floor}
  planning:
${high}
  frontier:
${high}
`;
	}
	if (profile === "climb") {
		const floor = role(FLOOR_MODEL_ID, "off");
		if (lever === "single") {
			return `hierarchy:
  mode: api
  suite: lfm
  quant: q4_k_m
  layering: single
roles:
  decision:
${floor}
`;
		}
		const high = role(CLIMB_MODEL_ID, "brief");
		return `hierarchy:
  mode: api
  suite: lfm
  quant: q4_k_m
  layering: auto
roles:
  decision:
${floor}
  tooling:
${floor}
  workhorse:
${floor}
  planning:
${high}
  frontier:
${high}
`;
	}
	const same = role(BENCH_MODEL_ID, "off");
	if (lever === "single") {
		return `hierarchy:
  mode: api
  suite: lfm
  quant: q4_k_m
  layering: single
roles:
  decision:
${same}
`;
	}
	return `hierarchy:
  mode: api
  suite: lfm
  quant: q4_k_m
  layering: auto
roles:
  decision:
${same}
  tooling:
${same}
  workhorse:
${same}
  planning:
${same}
`;
}

export function leverSettingsJson(profile: BenchProfile = "same"): string {
	const id = profile === "climb" ? FLOOR_MODEL_ID : profile === "fan" ? CLIMB_MODEL_ID : BENCH_MODEL_ID;
	return `${JSON.stringify({ defaultProvider: "xai", defaultModel: id }, null, 2)}\n`;
}

export function leverLabel(lever: BenchLever, profile: BenchProfile): string {
	if (profile === "fan" && lever === "auto") {
		return `xai/${CLIMB_MODEL_ID}+${FLOOR_MODEL_ID}`;
	}
	if (profile === "fan") {
		return `xai/${CLIMB_MODEL_ID}`;
	}
	if (profile === "climb" && lever === "auto") {
		return `xai/${FLOOR_MODEL_ID}+${CLIMB_MODEL_ID}`;
	}
	if (profile === "climb") {
		return `xai/${FLOOR_MODEL_ID}`;
	}
	return `xai/${BENCH_MODEL_ID}`;
}
