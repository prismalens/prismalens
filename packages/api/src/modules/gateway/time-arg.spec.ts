// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { timeArg, toUnixSeconds } from "./source-tools.js";

describe("timeArg", () => {
	it("accepts valid timestamps and existing calendar dates", () => {
		for (const v of [
			"1700000000",
			"1700000000.5",
			"2026-02-28T10:00:00Z",
			"2024-02-29T00:00:00Z",
			"2026-03-01T10:00:00+05:30",
		]) {
			expect(timeArg.safeParse(v).success).toBe(true);
		}
	});

	it("rejects date-times without an explicit timezone", () => {
		for (const v of [
			"2026-02-28T10:00:00",
			"2026-02-28T10:00",
			"2026-02-28T10:00:00+0530",
		]) {
			expect(timeArg.safeParse(v).success).toBe(false);
		}
		expect(timeArg.safeParse("2026-02-28").success).toBe(true);
	});

	it("rejects non-existent calendar dates", () => {
		for (const v of [
			"2026-02-30T10:00:00Z",
			"2026-04-31T00:00:00Z",
			"2026-13-01T00:00:00Z",
			"2023-02-29T00:00:00Z",
		]) {
			expect(timeArg.safeParse(v).success).toBe(false);
		}
	});
});

describe("toUnixSeconds", () => {
	it("converts timestamps and dates, returning NaN for invalid dates", () => {
		expect(toUnixSeconds("1700000000")).toBe(1700000000);
		expect(toUnixSeconds("2026-02-28T10:00:00Z")).toBe(
			Date.parse("2026-02-28T10:00:00Z") / 1000,
		);
		expect(toUnixSeconds("2026-02-30T10:00:00Z")).toBeNaN();
	});
});
