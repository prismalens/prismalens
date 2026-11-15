// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { cardHasState } from "./use-details-docked";

describe("the details card docks unasked only with thread state (#1101)", () => {
	it("stays shut when it holds only the agent and the machine", () => {
		expect(cardHasState([{ id: "agent" }, { id: "machine" }])).toBe(false);
	});

	it("docks when a branch, PR, child or schedule row is there", () => {
		expect(cardHasState([{ id: "agent" }, { id: "pr" }])).toBe(true);
		expect(cardHasState([{ id: "machine" }, { id: "schedule" }])).toBe(true);
	});

	it("stays shut with no rows yet", () => {
		expect(cardHasState(null)).toBe(false);
	});
});
