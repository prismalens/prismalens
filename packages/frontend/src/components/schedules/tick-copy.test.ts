// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { TICK_OUTCOMES, type ScheduleTick } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { tickLine } from "./tick-copy";

const tick = (over: Partial<ScheduleTick>): ScheduleTick => ({
	id: "t",
	scheduledFor: "2026-10-30T13:00:00.000Z",
	decidedAt: "2026-10-30T14:34:00.000Z",
	outcome: "started",
	reason: null,
	missedCount: 0,
	missedOverflow: false,
	run: null,
	...over,
});
const run = (over: Partial<NonNullable<ScheduleTick["run"]>> = {}) => ({
	id: "r",
	status: "completed" as const,
	summary: null,
	error: null,
	startedAt: null,
	completedAt: null,
	incidentId: null,
	incidentNumber: null,
	...over,
});
const fmt = (iso: string) => iso.slice(11, 16);

describe("tickLine (#979)", () => {
	it("has words for every outcome", () => {
		for (const outcome of TICK_OUTCOMES) {
			const line = tickLine(tick({ outcome, run: run() }), fmt);
			expect(line.text.length).toBeGreaterThan(5);
			expect(line.text).not.toMatch(/—|·/);
		}
	});

	it("says what a run found, and links its incident", () => {
		expect(tickLine(tick({ run: run() }), fmt)).toMatchObject({ tone: "ok", text: "Nothing wrong found" });
		expect(tickLine(tick({ run: run({ incidentId: "i", incidentNumber: 41 }) }), fmt)).toMatchObject({
			tone: "warn",
			text: "Found a likely cause: INC-41",
			link: { kind: "incident", id: "i", label: "Open INC-41" },
		});
		expect(tickLine(tick({ run: run({ status: "failed", error: "the agent stopped responding" }) }), fmt)).toMatchObject({
			tone: "bad",
			text: "Failed: the agent stopped responding",
		});
		expect(tickLine(tick({ run: run({ status: "running" }) }), fmt)).toMatchObject({ tone: "live", text: "Running now" });
	});

	it("says a late run ran after sleep, and when", () => {
		expect(tickLine(tick({ outcome: "late_started", reason: "asleep", run: run() }), fmt).text).toBe(
			"Ran late at 14:34 after sleep: nothing wrong found",
		);
		expect(tickLine(tick({ outcome: "missed_off", missedCount: 3 }), fmt).text).toBe(
			"Missed 3 runs: PrismaLens was off",
		);
	});
});
