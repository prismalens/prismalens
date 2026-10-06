// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	alertStatusTone,
	evidenceStatusTone,
	hypothesisStatusTone,
	incidentStatusTone,
	priorityTone,
	recommendationPriorityTone,
	runStateTone,
	runStatusTone,
	severityTone,
} from "./state-tone";

// The look ruling's §1.3 table, row by row: one status, one colour.
describe("state tone map", () => {
	it("incidents: triggered is danger, being worked neutral, cleared ok, closed quiet", () => {
		expect(incidentStatusTone("triggered")).toBe("danger");
		for (const s of ["investigating", "identified", "monitoring"])
			expect(incidentStatusTone(s)).toBe("neutral");
		expect(incidentStatusTone("resolved")).toBe("ok");
		expect(incidentStatusTone("closed")).toBe("quiet");
	});

	it("runs: live states live, a stop neutral, failed danger, done ok", () => {
		for (const s of ["starting", "working", "stopping"] as const)
			expect(runStateTone(s)).toBe("live");
		expect(runStateTone("stopped")).toBe("neutral");
		expect(runStateTone("failed")).toBe("danger");
		expect(runStateTone("done")).toBe("ok");
	});

	it("persisted runs: running live, completed ok, failed danger, cancelled neutral", () => {
		expect(runStatusTone("running")).toBe("live");
		expect(runStatusTone("completed")).toBe("ok");
		expect(runStatusTone("failed")).toBe("danger");
		expect(runStatusTone("cancelled")).toBe("neutral");
		expect(runStatusTone("pending")).toBe("neutral");
	});

	it("alerts: firing danger, acknowledged and correlated neutral, cleared ok, suppressed quiet", () => {
		expect(alertStatusTone("triggered")).toBe("danger");
		expect(alertStatusTone("acknowledged")).toBe("neutral");
		expect(alertStatusTone("correlated")).toBe("neutral");
		expect(alertStatusTone("resolved")).toBe("ok");
		expect(alertStatusTone("suppressed")).toBe("quiet");
	});

	it("confidence: confirmed ok, likely accent, unconfirmed warn", () => {
		expect(hypothesisStatusTone("confirmed")).toBe("ok");
		expect(hypothesisStatusTone("supported")).toBe("accent");
		expect(hypothesisStatusTone("speculative")).toBe("warn");
		expect(evidenceStatusTone("verified")).toBe("ok");
		expect(evidenceStatusTone("inferred")).toBe("neutral");
	});

	it("priority: critical danger, high sev-high, medium warn, low neutral", () => {
		expect(recommendationPriorityTone("critical")).toBe("danger");
		expect(recommendationPriorityTone("HIGH")).toBe("sev-high");
		expect(recommendationPriorityTone("medium")).toBe("warn");
		expect(recommendationPriorityTone("low")).toBe("neutral");
		expect(priorityTone("p1")).toBe("danger");
		expect(priorityTone("p4")).toBe("neutral");
	});

	it("severity dot: critical danger, high sev-high, medium warn, low sev-low, info quiet", () => {
		expect(severityTone("critical")).toBe("danger");
		expect(severityTone("high")).toBe("sev-high");
		expect(severityTone("medium")).toBe("warn");
		expect(severityTone("low")).toBe("sev-low");
		expect(severityTone("info")).toBe("quiet");
		expect(severityTone("unknown")).toBe("quiet");
	});
});
