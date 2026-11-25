// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Plugin } from "vite";

/** The `pin.json` fields only CI reads (scripts/agent-pins.mjs); the descriptors in the page read none. */
const CI_ONLY = [
	"adapter",
	"constraints",
	"minimumReleaseAgeDays",
	"tier",
	"why",
];

const AGENT_PIN =
	/[\\/]providers[\\/](?:src|dist)[\\/]agent[\\/][^\\/]+[\\/]pin\.json$/;

/** Keeps an agent pin's CI-only fields out of the bundle; its descriptor loads before first paint (#1125). */
export function pinFields(): Plugin {
	return {
		name: "prismalens:pin-fields",
		enforce: "pre",
		transform(code, id) {
			if (!AGENT_PIN.test(id)) return null;
			const pin = JSON.parse(code) as Record<string, unknown>;
			for (const field of CI_ONLY) delete pin[field];
			return { code: JSON.stringify(pin), map: null };
		},
	};
}
