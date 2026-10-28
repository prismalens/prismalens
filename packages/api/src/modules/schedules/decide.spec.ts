// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { decide, type Gap } from "./decide.js";
import type { Recurrence } from "./recurrence.js";

const daily9: Recurrence = { type: "cron", expr: "0 9 * * *", timezone: "UTC" };
const slot = new Date("2026-06-01T09:00:00Z");
const min = (n: number) => n * 60_000;
const after = (ms: number) => new Date(slot.getTime() + ms);
const noGap = (): Gap | null => null;

function state(over: Partial<Parameters<typeof decide>[0]> = {}) {
	return {
		recurrence: daily9,
		nextRunAt: slot,
		missedPolicy: "run_once" as const,
		catchUpMinutes: 360,
		...over,
	};
}

describe("decide (#979)", () => {
	it("does nothing before the slot", () => {
		expect(decide(state(), after(-1), noGap)).toBeNull();
	});

	it("starts on time, with the catch-up window as the start deadline", () => {
		const d = decide(state(), after(5_000), noGap);
		expect(d).toMatchObject({ outcome: "started", missedCount: 0 });
		expect(d?.startBy).toEqual(after(min(360)));
		expect(d?.next).toEqual(new Date("2026-06-02T09:00:00Z"));
	});

	it("runs once after a sleep that spanned three slots, and says it slept", () => {
		const slept: Gap = { kind: "asleep", from: new Date("2026-05-30T08:00:00Z"), to: after(min(90)) };
		const d = decide(
			state({ nextRunAt: new Date("2026-05-30T09:00:00Z") }),
			after(min(92)),
			() => slept,
		);
		expect(d).toMatchObject({ outcome: "late_started", gap: "asleep", missedCount: 2 });
		expect(d?.slot).toEqual(slot);
		expect(d?.next).toEqual(new Date("2026-06-02T09:00:00Z"));
	});

	it("records a miss when it was off past the catch-up window", () => {
		const off: Gap = { kind: "off", from: after(-min(10)), to: after(min(420)) };
		const d = decide(state(), after(min(421)), () => off);
		expect(d).toMatchObject({ outcome: "missed_off", missedCount: 1, startBy: null });
	});

	it("skips a late slot under the Skip policy, however short the delay", () => {
		const d = decide(state({ missedPolicy: "skip" }), after(min(5)), () => ({
			kind: "asleep",
			from: after(-1),
			to: after(min(4)),
		}));
		expect(d).toMatchObject({ outcome: "missed_asleep", startBy: null });
	});

	it("gives an on-time slot under Skip a 15-minute start deadline", () => {
		const d = decide(state({ missedPolicy: "skip" }), after(1_000), noGap);
		expect(d?.startBy).toEqual(after(min(15)));
	});

	it("labels a late slot with no recorded gap as late", () => {
		const d = decide(state({ missedPolicy: "skip" }), after(min(10)), noGap);
		expect(d?.outcome).toBe("missed_late");
	});

	it("records one miss when the whole backlog is older than the window", () => {
		const d = decide(
			state({ nextRunAt: new Date("2026-01-01T09:00:00Z") }),
			new Date("2026-06-01T20:00:00Z"),
			noGap,
			{ bound: 10 },
		);
		expect(d).toMatchObject({ outcome: "missed_late", missedOverflow: true });
		expect(d?.slot).toEqual(new Date("2026-01-01T09:00:00Z"));
		expect(d?.next).toEqual(new Date("2026-06-02T09:00:00Z"));
	});
});
