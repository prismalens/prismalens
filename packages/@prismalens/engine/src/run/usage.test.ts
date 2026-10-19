// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseUsageUpdate } from "./usage.js";

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
