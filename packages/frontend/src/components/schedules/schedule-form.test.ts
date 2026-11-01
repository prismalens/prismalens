// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { formOf, recurrenceOf, type WhenForm } from "./schedule-form";

const base: WhenForm = {
	preset: "weekdays",
	time: "09:00",
	timezone: "Asia/Kolkata",
	days: [1, 2, 3, 4, 5],
	everyHours: 6,
	startAt: "00:00",
	cron: "",
};

describe("recurrenceOf (#979)", () => {
	it("compiles each preset to the recurrence the API stores", () => {
		expect(recurrenceOf({ ...base, preset: "daily" })).toEqual({
			type: "cron",
			expr: "0 9 * * *",
			timezone: "Asia/Kolkata",
		});
		expect(recurrenceOf(base)).toMatchObject({ expr: "0 9 * * 1-5" });
		expect(recurrenceOf({ ...base, preset: "weekly", days: [1, 3], time: "07:30" })).toMatchObject({
			expr: "30 7 * * 1,3",
		});
		expect(recurrenceOf({ ...base, preset: "cron", cron: " 0 9,17 * * 1-5 " })).toMatchObject({
			expr: "0 9,17 * * 1-5",
		});
	});

	it("anchors every few hours on today's start time, as an elapsed interval", () => {
		const r = recurrenceOf({ ...base, timezone: "UTC", preset: "hours", everyHours: 6, startAt: "00:00" }, new Date("2026-10-30T12:40:00Z"));
		expect(r).toEqual({ type: "interval", everyMinutes: 360, anchorAt: "2026-10-30T00:00:00.000Z" });
	});

	it("reads a stored recurrence back into the form it came from", () => {
		expect(formOf({ type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" })).toMatchObject({
			preset: "weekdays",
			time: "09:00",
			timezone: "UTC",
		});
		expect(formOf({ type: "cron", expr: "30 7 * * 1,3", timezone: "UTC" })).toMatchObject({
			preset: "weekly",
			days: [1, 3],
		});
		expect(formOf({ type: "cron", expr: "*/30 9-17 * * *", timezone: "UTC" })).toMatchObject({
			preset: "cron",
			cron: "*/30 9-17 * * *",
		});
		expect(
			formOf({ type: "interval", everyMinutes: 360, anchorAt: "2026-10-30T00:00:00.000Z" }),
		).toMatchObject({ preset: "hours", everyHours: 6 });
	});

	it("shows an interval's start in the host zone it was entered in, and round-trips", () => {
		const stored = { type: "interval" as const, everyMinutes: 360, anchorAt: "2026-10-30T03:30:00.000Z" };
		const f = formOf(stored, "Asia/Kolkata");
		expect(f).toMatchObject({ preset: "hours", startAt: "09:00", timezone: "Asia/Kolkata" });
		expect(recurrenceOf(f, new Date("2026-10-30T12:40:00Z"))).toEqual(stored);
	});
});
