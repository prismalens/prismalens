// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { modeLine, YES_CLAUSE } from "./agent-modes";

describe("modeLine", () => {
	it("adds the clause wherever the agent can ask, plan and bypass included", () => {
		for (const id of ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "read-only", "agent"])
			expect(modeLine(id, "Own words")).toBe(`Own words. ${YES_CLAUSE}`);
	});

	it("leaves it off where the agent never asks", () => {
		expect(modeLine("agent-full-access", "Unrestricted access")).toBe(
			"Unrestricted access.",
		);
		expect(modeLine("agent-default")).toBe("");
	});
});
