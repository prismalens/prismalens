// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_PHASE,
	EVIDENCE_STATUS_PHASE,
	HYPOTHESIS_STATUS_PHASE,
	INCIDENT_STATUS_PHASE,
	PRIORITY_WEIGHT,
	RECOMMENDATION_PRIORITY_WEIGHT,
	SEVERITY_WEIGHT,
	WORKFLOW_STATUS_PHASE,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { StateTone } from "@/components/shared/StateWord";
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

// Look ruling §1.3, row by row, keyed by every value the contracts define: a
// status added to a contract fails here until it is given a tone on purpose.
type Expected = Record<string, StateTone>;

const DOMAINS: {
	name: string;
	contract: string[];
	tone: (k: string) => StateTone;
	expected: Expected;
}[] = [
	{
		name: "incident status",
		contract: Object.keys(INCIDENT_STATUS_PHASE),
		tone: incidentStatusTone,
		expected: {
			triggered: "danger",
			investigating: "neutral",
			identified: "neutral",
			monitoring: "neutral",
			resolved: "ok",
			closed: "quiet",
		},
	},
	{
		name: "alert status",
		contract: Object.keys(ALERT_STATUS_PHASE),
		tone: alertStatusTone,
		expected: {
			triggered: "danger",
			acknowledged: "neutral",
			correlated: "neutral",
			resolved: "ok",
			suppressed: "quiet",
		},
	},
	{
		name: "persisted run status",
		contract: Object.keys(WORKFLOW_STATUS_PHASE),
		tone: runStatusTone,
		expected: {
			pending: "neutral",
			running: "live",
			completed: "ok",
			failed: "danger",
			cancelled: "neutral",
		},
	},
	{
		name: "hypothesis status",
		contract: Object.keys(HYPOTHESIS_STATUS_PHASE),
		tone: hypothesisStatusTone,
		expected: {
			confirmed: "ok",
			supported: "accent",
			speculative: "warn",
			refuted: "danger",
		},
	},
	{
		name: "evidence status",
		contract: Object.keys(EVIDENCE_STATUS_PHASE),
		tone: evidenceStatusTone,
		expected: { verified: "ok", inferred: "neutral" },
	},
	{
		name: "severity",
		contract: Object.keys(SEVERITY_WEIGHT),
		tone: severityTone,
		expected: {
			critical: "danger",
			high: "sev-high",
			medium: "warn",
			low: "sev-low",
			info: "quiet",
		},
	},
	{
		name: "priority",
		contract: Object.keys(PRIORITY_WEIGHT),
		tone: priorityTone,
		expected: {
			p1: "danger",
			p2: "sev-high",
			p3: "warn",
			p4: "neutral",
			p5: "neutral",
		},
	},
	{
		name: "recommendation priority",
		contract: Object.keys(RECOMMENDATION_PRIORITY_WEIGHT),
		tone: recommendationPriorityTone,
		expected: {
			critical: "danger",
			high: "sev-high",
			medium: "warn",
			low: "neutral",
		},
	},
	{
		name: "run state",
		contract: ["starting", "working", "stopping", "stopped", "failed", "done"],
		tone: (k) => runStateTone(k as Parameters<typeof runStateTone>[0]),
		expected: {
			starting: "live",
			working: "live",
			stopping: "live",
			stopped: "neutral",
			failed: "danger",
			done: "ok",
		},
	},
];

const DEPRECATED_ALIASES: ReadonlySet<string> = new Set([
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"stale",
	"active",
	"done",
	"failed",
]);

describe("state tone coverage: every status the app renders has exactly one tone", () => {
	for (const d of DOMAINS) {
		describe(d.name, () => {
			it("the table names every value the contract defines, and nothing else", () => {
				expect(Object.keys(d.expected).sort()).toEqual([...d.contract].sort());
			});

			it("each value maps to its ruled tone, deterministically", () => {
				for (const key of d.contract) {
					const first = d.tone(key);
					expect(first, `${d.name}: ${key}`).toBe(d.expected[key]);
					expect(d.tone(key)).toBe(first);
				}
			});

			it("never emits a deprecated tone name", () => {
				for (const key of d.contract)
					expect(DEPRECATED_ALIASES.has(d.tone(key))).toBe(false);
			});
		});
	}

	it("an unknown value falls back to a neutral or quiet tone, never a hue", () => {
		for (const d of DOMAINS.filter((x) => x.name !== "run state")) {
			const t = d.tone("not-a-status");
			expect(["neutral", "quiet", "warn"], d.name).toContain(t);
		}
	});

	it("danger is reserved for states that need a human or have failed", () => {
		const danger = DOMAINS.flatMap((d) =>
			d.contract.filter((k) => d.tone(k) === "danger").map((k) => `${d.name}:${k}`),
		);
		expect(danger.sort()).toEqual(
			[
				"incident status:triggered",
				"alert status:triggered",
				"persisted run status:failed",
				"hypothesis status:refuted",
				"severity:critical",
				"priority:p1",
				"recommendation priority:critical",
				"run state:failed",
			].sort(),
		);
	});
});
