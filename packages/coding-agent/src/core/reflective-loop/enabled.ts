import { isTrekEnvTruthy } from "../../utils/trek-env.ts";

/** Reflective O→I→A→R loop enabled by default in 0.3.0; opt out with TREK_REFLECTIVE_LOOP=0. */
export function isReflectiveLoopEnabled(): boolean {
	if (process.env.TREK_REFLECTIVE_LOOP === "0" || process.env.PI_REFLECTIVE_LOOP === "0") {
		return false;
	}
	if (isTrekEnvTruthy("REFLECTIVE_LOOP")) {
		return true;
	}
	// Default on for Trek 0.3.0+
	return process.env.TREK_REFLECTIVE_LOOP !== "false";
}
