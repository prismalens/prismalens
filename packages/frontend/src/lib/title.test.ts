// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { readableTitle } from "./title";

describe("readableTitle", () => {
	it("splits an alert name into words", () => {
		expect(readableTitle("CheckoutLatencyHigh")).toBe("Checkout latency high");
	});
	it("keeps acronyms whole", () => {
		expect(readableTitle("APILatencyP99High")).toBe("API latency P99 high");
	});
	it("leaves a sentence alone", () => {
		expect(readableTitle("CI failed on main")).toBe("CI failed on main");
	});
});
