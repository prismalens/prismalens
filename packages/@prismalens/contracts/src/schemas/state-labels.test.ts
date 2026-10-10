// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	ACCESS_LEVEL_LINE,
	INCIDENT_ACTION_LABEL,
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	LIVE_TURN_LABEL,
	NO_SANDBOX,
	PRIORITY_LABEL,
	RUN_MODE_LINE,
	runStateLabel,
	TURN_OUTCOME_LABEL,
} from "./state-labels.js";
import {
	ACCESS_LEVELS,
	HARNESS_REGISTRY,
} from "@prismalens/config/harness";
import {
	BAND_ACTIONS,
	INCIDENT_ACTION_FROM,
	INCIDENT_ACTION_WRITES,
	type RunState,
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

describe("runStateLabel covers every kind × state (#673 w59)", () => {
	const table: Record<RunState, [string, string]> = {
		starting: ["Starting", "Starting"],
		working: ["Working", "Working"],
		stopping: ["Stopping", "Stopping"],
		stopped: ["Stopped by you", "Stopped by you"],
		failed: ["Failed", "Error"],
		done: ["Done", "Ended"],
	};

	it.each(Object.entries(table))("%s reads %j", (state, [inv, chat]) => {
		expect(runStateLabel("investigation", state as RunState)).toBe(inv);
		expect(runStateLabel("chat", state as RunState)).toBe(chat);
	});

	it("reads a row without a kind as an investigation", () => {
		expect(runStateLabel(undefined, "done")).toBe("Done");
		expect(runStateLabel(null, "failed")).toBe("Failed");
	});

	it("names each live turn and each last-message outcome", () => {
		expect(LIVE_TURN_LABEL).toEqual({
			report: "Working toward a report",
			answer: "Working on an answer",
		});
		expect(TURN_OUTCOME_LABEL.stopped).toBe("stopped by you");
		expect(TURN_OUTCOME_LABEL.error).toBe("error");
	});
});

describe("word guard (#673 w21 ruling)", () => {
	it("asserts every ACCESS_LEVEL_LINE, RUN_MODE_LINE, NO_SANDBOX and row line(null) is non-empty and contains no forbidden words", () => {
		const forbidden = /\bnever\b|\bonly\b|without sending|PrismaLens refuses/i;
		const allLines: string[] = [
			...Object.values(ACCESS_LEVEL_LINE),
			...Object.values(RUN_MODE_LINE),
			NO_SANDBOX,
		];

		for (const harness of Object.values(HARNESS_REGISTRY)) {
			for (const level of ACCESS_LEVELS) {
				allLines.push(harness.access[level].line(null));
			}
		}

		for (const line of allLines) {
			expect(line.trim().length).toBeGreaterThan(0);
			expect(line).not.toMatch(forbidden);
		}
	});
});

