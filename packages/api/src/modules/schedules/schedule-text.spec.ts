// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { describeRecurrence, dstNote } from "./schedule-text.js";

const cron = (expr: string, timezone = "Asia/Kolkata") => ({
	type: "cron" as const,
	expr,
	timezone,
});

describe("describeRecurrence (#979)", () => {
	it("says the presets the way the dialog offers them", () => {
		expect(describeRecurrence(cron("0 9 * * *"))).toBe("Every day at 09:00");
		expect(describeRecurrence(cron("0 9 * * 1-5"))).toBe("Every weekday at 09:00");
		expect(describeRecurrence(cron("30 7 * * 1"))).toBe("Every Monday at 07:30");
		expect(
			describeRecurrence({ type: "interval", everyMinutes: 360, anchorAt: new Date(0) }),
		).toBe("Every 6 hours");
		expect(
			describeRecurrence({ type: "interval", everyMinutes: 90, anchorAt: new Date(0) }),
		).toBe("Every 90 minutes");
	});

	it("falls back to a 24-hour description for any other cron", () => {
		expect(describeRecurrence(cron("0 9,17 * * 1-5"))).toBe(
			"At 09:00 and 17:00, Monday through Friday",
		);
	});
});

describe("dstNote (#979, adversary OBJ-008)", () => {
	const ny = (expr: string) => cron(expr, "America/New_York");
	const before = new Date("2026-10-28T12:00:00Z");

	it("says a fixed time keeps its local time across a change", () => {
		expect(dstNote(ny("0 9 * * 1-5"), before)).toBe(
			"Clocks change in America/New_York on Sun 1 Nov. Runs stay at 09:00 local time.",
		);
	});

	it("warns that a repeating schedule runs twice in the repeated hour", () => {
		expect(dstNote(ny("30 1,3 * * *"), before)).toMatch(/runs twice between 01:00 and 02:00/);
	});

	it("says a time inside the spring gap moves", () => {
		expect(dstNote(ny("30 2 * * *"), new Date("2026-03-01T12:00:00Z"))).toMatch(
			/the 02:30 run is at 03:00/,
		);
	});

	it("says nothing when no change is near or the zone has none", () => {
		expect(dstNote(ny("0 9 * * *"), new Date("2026-06-01T00:00:00Z"))).toBeNull();
		expect(dstNote(cron("0 9 * * *"), before)).toBeNull();
		expect(dstNote({ type: "interval", everyMinutes: 60, anchorAt: new Date(0) }, before)).toBeNull();
	});
});
