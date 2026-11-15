// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseUsageUpdate, quotaOf, turnUsageOf } from "./usage.js";

const now = new Date("2026-10-20T09:00:00Z");

describe("parseUsageUpdate", () => {
	it("keeps context and cost", () => {
		expect(
			parseUsageUpdate(
				{ used: 182_000, size: 440_000, cost: { amount: 1.5, currency: "USD" } },
				now,
			),
		).toEqual({
			used: 182_000,
			size: 440_000,
			cost: { amount: 1.5, currency: "USD" },
			at: now.toISOString(),
		});
	});

	it("keeps context when the cost is absent or malformed", () => {
		const bare = { used: 10, size: 100, at: now.toISOString() };
		expect(parseUsageUpdate({ used: 10, size: 100 }, now)).toEqual(bare);
		expect(parseUsageUpdate({ used: 10, size: 100, cost: null }, now)).toEqual(
			bare,
		);
		expect(
			parseUsageUpdate({ used: 10, size: 100, cost: { amount: "x" } }, now),
		).toEqual(bare);
	});

	it("reads an update without numbers as no usage, not zero", () => {
		expect(parseUsageUpdate({}, now)).toBeNull();
		expect(parseUsageUpdate({ used: "3", size: 100 }, now)).toBeNull();
	});
});

describe("turnUsageOf", () => {
	it("maps cachedReadTokens and cachedWriteTokens to cacheReadTokens and cacheWriteTokens", () => {
		expect(
			turnUsageOf({
				usage: {
					inputTokens: 100,
					outputTokens: 50,
					cachedReadTokens: 40,
					cachedWriteTokens: 20,
					thoughtTokens: 10,
					totalTokens: 220,
				},
			}),
		).toEqual({
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 40,
			cacheWriteTokens: 20,
			thoughtTokens: 10,
			totalTokens: 220,
		});
	});

	it("takes the model from _meta.quota.model_usage only when exactly one model is named", () => {
		expect(
			turnUsageOf({
				usage: { inputTokens: 100 },
				_meta: { quota: { model_usage: [{ model: "claude-3-7-sonnet" }] } },
			}),
		).toEqual({
			model: "claude-3-7-sonnet",
			inputTokens: 100,
		});

		expect(
			turnUsageOf({
				usage: { inputTokens: 100 },
				_meta: {
					quota: {
						model_usage: [
							{ model: "claude-3-7-sonnet" },
							{ model: "claude-3-7-sonnet" },
						],
					},
				},
			}),
		).toEqual({
			model: "claude-3-7-sonnet",
			inputTokens: 100,
		});

		expect(
			turnUsageOf({
				usage: { inputTokens: 100 },
				_meta: {
					quota: {
						model_usage: [
							{ model: "claude-3-7-sonnet" },
							{ model: "gpt-4o" },
						],
					},
				},
			}),
		).toEqual({
			inputTokens: 100,
		});

		expect(
			turnUsageOf({
				usage: { inputTokens: 100 },
				_meta: { quota: { model_usage: [] } },
			}),
		).toEqual({
			inputTokens: 100,
		});
	});

	it("returns null for no usage", () => {
		expect(turnUsageOf(null)).toBeNull();
		expect(turnUsageOf({})).toBeNull();
		expect(turnUsageOf({ usage: null })).toBeNull();
		expect(turnUsageOf({ usage: "not-an-object" })).toBeNull();
	});

	it("returns null for a usage with only negative/non-integer counts", () => {
		expect(
			turnUsageOf({ usage: { inputTokens: -1, outputTokens: 1.5 } }),
		).toBeNull();
		expect(turnUsageOf({ usage: { totalTokens: -5 } })).toBeNull();
		expect(
			turnUsageOf({
				usage: { inputTokens: -1 },
				_meta: { quota: { model_usage: [{ model: "claude-3-7-sonnet" }] } },
			}),
		).toBeNull();
	});
});

describe("quotaOf", () => {
	it("reads _meta['_claude/rateLimit'] into structured quota", () => {
		expect(
			quotaOf({
				"_claude/rateLimit": {
					rateLimitType: "five_hour",
					utilization: 0.9,
					resetsAt: 1700000000,
					status: "allowed_warning",
				},
			}),
		).toEqual({
			window: "session",
			type: "five_hour",
			usedPercent: 90,
			resetsAt: "2023-11-14T22:13:20.000Z",
			status: "allowed_warning",
		});
	});

	it("maps seven_day to weekly window and seven_day_opus to model window", () => {
		expect(
			quotaOf({
				"_claude/rateLimit": {
					rateLimitType: "seven_day",
					utilization: 0.5,
				},
			})?.window,
		).toBe("weekly");

		expect(
			quotaOf({
				"_claude/rateLimit": {
					rateLimitType: "seven_day_opus",
					utilization: 0.5,
				},
			})?.window,
		).toBe("model");
	});

	it("preserves utilization when already a percentage", () => {
		expect(
			quotaOf({
				"_claude/rateLimit": {
					utilization: 85,
				},
			})?.usedPercent,
		).toBe(85);
	});

	it("returns null when _claude/rateLimit is absent", () => {
		expect(quotaOf({})).toBeNull();
		expect(quotaOf(null)).toBeNull();
		expect(quotaOf({ other: 123 })).toBeNull();
	});

	it("returns null for an object with none of utilization, resetsAt, status", () => {
		expect(
			quotaOf({
				"_claude/rateLimit": {
					rateLimitType: "five_hour",
				},
			}),
		).toBeNull();
	});
});
