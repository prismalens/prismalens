// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	addTurn,
	bucketKey,
	bucketKeys,
	emptyBucket,
	readTurnUsage,
} from "./usage.js";

describe("usage pure helpers", () => {
	it("bucketKey formats hour and day keys in UTC", () => {
		const date = new Date("2026-11-12T14:45:30.123Z");
		expect(bucketKey(date, "hour")).toBe("2026-11-12T14:00:00.000Z");
		expect(bucketKey(date, "day")).toBe("2026-11-12");
	});

	it("bucketKeys produces 25 hourly keys for 24h and 8 day keys for 7d", () => {
		const sinceHour = new Date("2026-11-11T12:00:00.000Z");
		const untilHour = new Date("2026-11-12T12:00:00.000Z");
		const hourly = bucketKeys(sinceHour, untilHour, "hour");
		expect(hourly.length).toBe(25);
		expect(hourly[0]).toBe("2026-11-11T12:00:00.000Z");
		expect(hourly[24]).toBe("2026-11-12T12:00:00.000Z");

		const sinceDay = new Date("2026-11-05T00:00:00.000Z");
		const untilDay = new Date("2026-11-12T00:00:00.000Z");
		const daily = bucketKeys(sinceDay, untilDay, "day");
		expect(daily.length).toBe(8);
		expect(daily[0]).toBe("2026-11-05");
		expect(daily[7]).toBe("2026-11-12");
	});

	it("readTurnUsage returns null for a non-turn_usage event and for bad JSON", () => {
		expect(readTurnUsage("not valid json {")).toBe(null);
		expect(
			readTurnUsage(
				JSON.stringify({ kind: "agent_quota", usage: { inputTokens: 10 } }),
			),
		).toBe(null);
		expect(
			readTurnUsage(
				JSON.stringify({ kind: "turn_usage", usage: { inputTokens: 50 } }),
			),
		).toEqual({
			inputTokens: 50,
		});
	});

	it("addTurn adds totals, prefers totalTokens over the sum, handles unpriced and currency mismatches", () => {
		const bucket = emptyBucket("USD");
		addTurn(bucket, {
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 20,
			cacheWriteTokens: 10,
			totalTokens: 500,
			cost: { amount: 0.05, currency: "USD" },
		});

		expect(bucket.turns).toBe(1);
		expect(bucket.tokens.input).toBe(100);
		expect(bucket.tokens.output).toBe(50);
		expect(bucket.tokens.cacheRead).toBe(20);
		expect(bucket.tokens.cacheWrite).toBe(10);
		expect(bucket.tokens.total).toBe(500);
		expect(bucket.cost.amount).toBe(0.05);
		expect(bucket.cost.unpricedTurns).toBe(0);

		// A cost in another currency counts as unpriced
		addTurn(bucket, {
			inputTokens: 10,
			outputTokens: 10,
			cost: { amount: 100, currency: "EUR" },
		});
		expect(bucket.turns).toBe(2);
		expect(bucket.cost.amount).toBe(0.05);
		expect(bucket.cost.unpricedTurns).toBe(1);

		// A turn without cost increments unpricedTurns and leaves amount null when previously null
		const freshBucket = emptyBucket("USD");
		addTurn(freshBucket, {
			inputTokens: 25,
			outputTokens: 25,
		});
		expect(freshBucket.turns).toBe(1);
		expect(freshBucket.cost.amount).toBe(null);
		expect(freshBucket.cost.unpricedTurns).toBe(1);
	});
});
