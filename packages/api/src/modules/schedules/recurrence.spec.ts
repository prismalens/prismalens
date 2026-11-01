// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	cronShape,
	dueSlots,
	firstSlotAtOrAfter,
	nextSlots,
	type Recurrence,
	recurrenceError,
} from "./recurrence.js";

const ny = (expr: string): Recurrence => ({
	type: "cron",
	expr,
	timezone: "America/New_York",
});
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("cron shapes (#979, adversary OBJ-008)", () => {
	it("calls single minute and hour fixed, and lists, ranges or steps repeating", () => {
		expect(cronShape("30 9 * * 1-5")).toBe("fixed");
		expect(cronShape("0 9,17 * * *")).toBe("repeating");
		expect(cronShape("*/30 1 * * *")).toBe("repeating");
		expect(cronShape("0 8-18 * * *")).toBe("repeating");
	});

	it("refuses an expression croner cannot parse, and one under 15 minutes apart", () => {
		expect(recurrenceError(ny("61 9 * * *"))).toMatch(/cron/i);
		expect(recurrenceError(ny("*/5 * * * *"))).toMatch(/15 minutes/);
		expect(recurrenceError(ny("0 9 * * *"))).toBeNull();
		expect(
			recurrenceError({
				type: "interval",
				everyMinutes: 10,
				anchorAt: new Date(0),
			}),
		).toMatch(/15 minutes/);
	});
});

describe("daylight saving (#979)", () => {
	it("moves a fixed time inside the spring gap to the first valid time that day", () => {
		const [first, second] = nextSlots(
			ny("30 2 * * *"),
			new Date("2026-03-07T12:00:00Z"),
			2,
		);
		expect(iso(first)).toBe("2026-03-08T07:00:00.000Z"); // 03:00 EDT
		expect(iso(second)).toBe("2026-03-09T06:30:00.000Z"); // 02:30 EDT
	});

	it("runs a fixed time in the repeated autumn hour once", () => {
		const slots = nextSlots(
			ny("30 1 * * *"),
			new Date("2026-10-31T12:00:00Z"),
			2,
		);
		expect(slots.map(iso)).toEqual([
			"2026-11-01T05:30:00.000Z", // 01:30 EDT, the first pass
			"2026-11-02T06:30:00.000Z",
		]);
	});

	it("runs a repeating expression in both passes of the repeated hour, as documented", () => {
		const slots = nextSlots(
			ny("30 1,3 * * *"),
			new Date("2026-10-31T12:00:00Z"),
			3,
		);
		expect(slots.map(iso)).toEqual([
			"2026-11-01T05:30:00.000Z",
			"2026-11-01T06:30:00.000Z",
			"2026-11-01T08:30:00.000Z",
		]);
	});

	it("keeps an elapsed interval exact across the change", () => {
		const every6h: Recurrence = {
			type: "interval",
			everyMinutes: 360,
			anchorAt: new Date("2026-11-01T00:00:00Z"),
		};
		const slots = nextSlots(every6h, new Date("2026-11-01T00:00:00Z"), 3);
		expect(slots.map(iso)).toEqual([
			"2026-11-01T06:00:00.000Z",
			"2026-11-01T12:00:00.000Z",
			"2026-11-01T18:00:00.000Z",
		]);
	});
});

describe("the latest due slot (#979, adversary OBJ-007)", () => {
	const daily9 = ny("0 9 * * *");
	const slot = new Date("2026-06-01T13:00:00Z"); // 09:00 EDT

	it("finds a slot that is exactly now, and at every offset inside its first second", () => {
		expect(iso(firstSlotAtOrAfter(daily9, slot))).toBe(iso(slot));
		for (const ms of [0, 1, 250, 999]) {
			const now = new Date(slot.getTime() + ms);
			const due = dueSlots(daily9, slot, now);
			expect(iso(due.candidate)).toBe(iso(slot));
			expect(due.count).toBe(1);
			expect(iso(due.next)).toBe("2026-06-02T13:00:00.000Z");
		}
	});

	it("returns nothing due one millisecond before the slot", () => {
		const due = dueSlots(daily9, slot, new Date(slot.getTime() - 1));
		expect(due.candidate).toBeNull();
		expect(due.count).toBe(0);
		expect(iso(due.next)).toBe(iso(slot));
	});

	it("takes the latest of a backlog and counts the rest", () => {
		const now = new Date("2026-06-03T15:00:00Z");
		const due = dueSlots(daily9, slot, now);
		expect(iso(due.candidate)).toBe("2026-06-03T13:00:00.000Z");
		expect(due.count).toBe(3);
		expect(due.overflow).toBe(false);
	});

	it("walks a backlog of 101 slots to the true latest one", () => {
		const hourly: Recurrence = { type: "cron", expr: "0 * * * *", timezone: "UTC" };
		const from = new Date("2026-06-01T00:00:00Z");
		const now = new Date(from.getTime() + 100 * 3_600_000 + 5);
		const due = dueSlots(hourly, from, now);
		expect(due.count).toBe(101);
		expect(iso(due.candidate)).toBe(new Date(from.getTime() + 100 * 3_600_000).toISOString());
	});

	it("finds the latest slot past the walk's bound, at the boundary and just after (adversary OBJ-007)", () => {
		const q: Recurrence = { type: "cron", expr: "*/15 * * * *", timezone: "UTC" };
		const from = new Date("2026-01-01T00:00:00Z");
		const window = 6 * 60 * 60_000;
		for (const backlog of [4999, 5000, 5001, 6000]) {
			const last = new Date(from.getTime() + (backlog - 1) * 15 * 60_000);
			for (const offset of [0, 500, 7 * 60_000]) {
				const now = new Date(last.getTime() + offset);
				const due = dueSlots(q, from, now, { bound: 5000, windowMs: window });
				expect(iso(due.candidate)).toBe(iso(last));
				expect(due.overflow).toBe(backlog > 5000);
				expect(iso(due.next)).toBe(new Date(last.getTime() + 15 * 60_000).toISOString());
			}
		}
	}, 30_000);

	it("reports nothing to run when the whole backlog is older than the window", () => {
		const daily = ny("0 9 * * *");
		const now = new Date("2026-06-03T20:00:00Z"); // 11 h after the last slot
		const due = dueSlots(daily, slot, now, { bound: 1, windowMs: 6 * 60 * 60_000 });
		expect(due.overflow).toBe(true);
		expect(due.candidate).toBeNull();
		expect(iso(due.next)).toBe("2026-06-04T13:00:00.000Z");
	});

	it("skips the weekend for a weekday schedule", () => {
		const weekdays = ny("0 9 * * 1-5");
		const fri = new Date("2026-10-30T13:00:00Z");
		const due = dueSlots(weekdays, fri, new Date("2026-11-01T20:00:00Z"));
		expect(due.count).toBe(1);
		expect(iso(due.next)).toBe("2026-11-02T14:00:00.000Z"); // Mon 09:00 EST
	});
});
