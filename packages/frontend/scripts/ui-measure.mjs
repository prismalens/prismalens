// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Reads one design-matrix run (`matrix.json`) into per-state numbers; shared by
 * ui-budget.mjs (writes the ceilings) and check-ui-budget.mjs (holds a run to them).
 * The phone composer's chip row scrolls sideways on purpose, so it never counts.
 */
import { readFileSync } from "node:fs";

export function measures(dir) {
	const { report } = JSON.parse(readFileSync(`${dir}/matrix.json`, "utf8"));
	const out = {};
	for (const [state, m] of Object.entries(report)) {
		out[state] = {
			contrastFails: m.contrast.length,
			smallTargets: m.smallTargets.length,
			clipped: m.clipped.length,
			sideways: (m.sideways ?? []).filter(
				(s) => !s.startsWith("composer-chips"),
			).length,
			consoleErrors: state.startsWith("error-") ? m.consoleErrors.length : 0,
			otherAxe: m.axeOther.length,
			controls: m.controls ?? 0,
		};
	}
	return out;
}
