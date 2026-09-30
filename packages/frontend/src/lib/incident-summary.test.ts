// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { incidentSummary } from "./incident-summary";

const now = Date.parse("2026-09-30T12:00:00Z");
const alert = (status: string, at = "2026-09-29T12:00:00Z") => ({
	status,
	triggeredAt: at,
});

describe("incidentSummary", () => {
	it("says what fires, that the agent keeps failing, and that it read no code", () => {
		const s = incidentSummary({
			now,
			alerts: [alert("triggered"), alert("triggered"), alert("resolved")],
			services: ["Edge Gateway"],
			runs: [
				{ status: "failed", error: "provider error 529: overloaded_error" },
				{ status: "failed", error: "529" },
				{ status: "completed", rootCause: "x" },
			],
			noRepo: true,
			attention: "failed_run",
		});
		expect(s.lines).toEqual([
			"2 of 3 alerts firing on Edge Gateway, the first 24 hours ago.",
			"2 investigations in a row failed: the model provider was overloaded.",
			"No repository is linked, so the agent read no code.",
		]);
		expect(s.next?.kind).toBe("link-repo");
	});

	it("puts acknowledging first", () => {
		const s = incidentSummary({
			now,
			alerts: [],
			services: [],
			runs: [],
			noRepo: false,
			attention: "unacknowledged",
		});
		expect(s.lines).toEqual(["No alerts are correlated.", "No investigation yet."]);
		expect(s.next?.kind).toBe("acknowledge");
	});

	it("carries a concluded cause and suggests resolving", () => {
		const s = incidentSummary({
			now,
			alerts: [alert("resolved")],
			services: [],
			runs: [{ status: "completed", rootCause: "Pool capped at 10." }],
			noRepo: false,
			attention: null,
		});
		expect(s.lines[1]).toBe("The last investigation concluded: Pool capped at 10.");
		expect(s.next?.kind).toBe("resolve");
	});
});
