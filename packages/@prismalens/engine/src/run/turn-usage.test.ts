// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { turnUsage } from "./investigate.js";

describe("turnUsage", () => {
	it("cost is the cumulative delta", () => {
		expect(
			turnUsage(
				{ inputTokens: 100 },
				{ amount: 1.2, currency: "USD" },
				{ amount: 1.5, currency: "USD" },
				"claude-3",
			),
		).toEqual({
			model: "claude-3",
			inputTokens: 100,
			cost: { amount: 0.3, currency: "USD" },
		});

		expect(
			turnUsage(
				undefined,
				{ amount: 1.2, currency: "USD" },
				{ amount: 1.5, currency: "USD" },
				"claude-3",
			),
		).toEqual({
			model: "claude-3",
			cost: { amount: 0.3, currency: "USD" },
		});
	});

	it("null costBefore (reopened session) gives no cost", () => {
		expect(
			turnUsage(
				{ inputTokens: 100 },
				null,
				{ amount: 1.5, currency: "USD" },
				"claude-3",
			),
		).toEqual({
			model: "claude-3",
			inputTokens: 100,
		});

		expect(
			turnUsage(
				undefined,
				null,
				{ amount: 1.5, currency: "USD" },
				"claude-3",
			),
		).toBeNull();
	});

	it("a lower cumulative cost (session cleared) gives no cost", () => {
		expect(
			turnUsage(
				{ inputTokens: 100 },
				{ amount: 2.0, currency: "USD" },
				{ amount: 1.0, currency: "USD" },
				"claude-3",
			),
		).toEqual({
			model: "claude-3",
			inputTokens: 100,
		});
	});

	it("a currency change gives no cost", () => {
		expect(
			turnUsage(
				{ inputTokens: 100 },
				{ amount: 1.0, currency: "EUR" },
				{ amount: 1.5, currency: "USD" },
				"claude-3",
			),
		).toEqual({
			model: "claude-3",
			inputTokens: 100,
		});
	});
});
