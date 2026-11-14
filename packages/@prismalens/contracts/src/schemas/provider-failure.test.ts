// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { inboundLine } from "./provider-failure-values.js";

describe("inboundLine", () => {
	it("returns 'Delivered' for a delivered message", () => {
		expect(inboundLine("delivered")).toBe("Delivered");
	});

	it("returns 'Waiting: Claude Code reached its session limit' when waiting under a session usage limit", () => {
		expect(
			inboundLine("waiting", {
				failure: { mode: "usage_limit", window: "session" },
				agent: "Claude Code",
			}),
		).toBe("Waiting: Claude Code reached its session limit");
	});

	it("returns 'Not delivered: The thread was settled' for a settled failure, and 'Waiting' when waiting with no reason", () => {
		expect(inboundLine("failed", { cause: "settled" })).toBe(
			"Not delivered: The thread was settled",
		);
		expect(inboundLine("waiting")).toBe("Waiting");
	});
});
