// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { usageView } from "./run-usage";

const at = "2026-10-20T09:00:00Z";

describe("usageView", () => {
	it("reads no usage as not reported, never zero", () => {
		for (const none of [null, undefined]) {
			const v = usageView(none, "Claude Code");
			expect(v).toMatchObject({ text: "usage not reported", reported: false });
			expect(v.text).not.toMatch(/\b0\b/);
			expect(v.title).toContain("not zero");
		}
	});

	it("shows tokens and the share of the context window", () => {
		expect(usageView({ used: 182_000, size: 440_000, at }, "Codex")).toMatchObject({
			text: "182k tok (ctx 41%)",
			reported: true,
		});
	});

	it("keeps a real zero as reported, and drops the share when the window is unknown", () => {
		expect(usageView({ used: 0, size: 0, at }, "Codex").text).toBe("0 tok");
		expect(usageView({ used: 1_250_000, size: 2_000_000, at }, "x").text).toBe(
			"1.3M tok (ctx 63%)",
		);
	});

	it("names the cost when the harness sends one", () => {
		const v = usageView(
			{ used: 5, size: 10, cost: { amount: 1.5, currency: "USD" }, at },
			"Codex",
		);
		expect(v.title).toContain("cost 1.50 USD");
	});
});
