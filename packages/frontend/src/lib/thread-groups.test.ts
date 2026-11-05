// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { dayGroup, threadGroups } from "./thread-groups";

const now = new Date(2026, 10, 5, 15, 0).getTime();
const at = (d: number, h = 9) => new Date(2026, 10, d, h, 0).getTime();

describe("threadGroups", () => {
	it("cuts rows into Today, Yesterday, this week and months, in order", () => {
		const rows = [
			at(5),
			at(5, 1),
			at(4),
			at(1),
			new Date(2026, 9, 20).getTime(),
		].map((a) => ({ at: a }));
		expect(threadGroups(rows, now).map((g) => [g.label, g.rows.length])).toEqual([
			["Today", 2],
			["Yesterday", 1],
			["Earlier this week", 1],
			["October 2026", 1],
		]);
	});

	it("cuts days at local midnight, whatever the day's length", () => {
		// 2026-11-01 is 25 hours long in zones that end DST then; a fixed 24h step would call Oct 31 23:30 Yesterday.
		const monday = new Date(2026, 10, 2, 10, 0).getTime();
		expect(dayGroup(new Date(2026, 9, 31, 23, 30).getTime(), monday)).toBe(
			"Earlier this week",
		);
		expect(dayGroup(new Date(2026, 10, 1, 0, 30).getTime(), monday)).toBe(
			"Yesterday",
		);
	});

	it("names a day more than a week back by its month", () => {
		expect(dayGroup(new Date(2026, 9, 2).getTime(), now)).toBe("October 2026");
	});
});
