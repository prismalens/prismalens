// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	INCIDENT_ACTION_LABEL,
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	PRIORITY_LABEL,
} from "./state-labels.js";
import {
	BAND_ACTIONS,
	INCIDENT_ACTION_FROM,
	INCIDENT_ACTION_WRITES,
} from "./state-semantics.js";

describe("incident words (R1a d1)", () => {
	it("calls every stored status one of the four words a user reads", () => {
		for (const word of Object.values(INCIDENT_STATUS_LABEL)) {
			expect(["Triggered", "Acknowledged", "Alerts cleared", "Resolved"]).toContain(
				word,
			);
		}
		expect(INCIDENT_STATUS_LABEL.closed).toBe("Resolved");
		expect(INCIDENT_STATUS_LABEL.resolved).toBe("Alerts cleared");
	});

	it("puts no dot-chain and no Close in any label", () => {
		const words = [
			...Object.values(INCIDENT_STATUS_LABEL),
			...Object.values(INCIDENT_ATTENTION_LABEL),
			...Object.values(INCIDENT_ACTION_LABEL),
			...Object.values(PRIORITY_LABEL),
		];
		for (const w of words) {
			expect(w).not.toContain("·");
			expect(w).not.toMatch(/\bClose/);
		}
	});

	it("never lets a band button write a status whose label contradicts the button", () => {
		const verbOf: Record<string, string> = {
			Acknowledged: "Acknowledge",
			Resolved: "Resolve",
		};
		for (const action of BAND_ACTIONS) {
			const writes = INCIDENT_ACTION_WRITES[action];
			expect(writes, action).toBeDefined();
			if (!writes) continue;
			const button = INCIDENT_ACTION_LABEL[action];
			const word = INCIDENT_STATUS_LABEL[writes];
			// A Resolve button lands on Resolved, an Acknowledge on Acknowledged.
			if (button === "Resolve" || button === "Acknowledge")
				expect(word, action).toBe(`${button}d`);
			// Only the Resolve button lands on Resolved.
			if (verbOf[word] === "Resolve") expect(button, action).toBe("Resolve");
			// Every band action is offered from somewhere.
			expect(INCIDENT_ACTION_FROM[action].length).toBeGreaterThan(0);
		}
		// The source's own ending reads Alerts cleared, so no button may carry it.
		expect(BAND_ACTIONS).not.toContain("resolve");
		expect(INCIDENT_STATUS_LABEL[INCIDENT_ACTION_WRITES.resolve ?? "resolved"]).toBe(
			"Alerts cleared",
		);
	});
});
