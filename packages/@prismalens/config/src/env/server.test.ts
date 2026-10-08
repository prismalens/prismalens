// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { alertFlapWindowMs } from "./server.js";

describe("PRISMALENS_ALERT_FLAP_WINDOW_MINUTES", () => {
	it("defaults to 24 hours (#673 w25)", () => {
		expect(alertFlapWindowMs({})).toBe(24 * 60 * 60 * 1000);
	});

	it("reads an explicit value in minutes", () => {
		expect(
			alertFlapWindowMs({ PRISMALENS_ALERT_FLAP_WINDOW_MINUTES: "15" }),
		).toBe(15 * 60 * 1000);
	});
});
