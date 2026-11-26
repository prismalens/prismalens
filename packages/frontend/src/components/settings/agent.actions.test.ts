// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { agentCheckAll } from "./agent.actions";

describe("agent.actions.ts", () => {
	it("agent.checkAll runs the list's Check all, and is off while checking or with nothing to check", () => {
		const checkAll = vi.fn();
		agentCheckAll.run({ checkAll, facts: {} });
		expect(checkAll).toHaveBeenCalledTimes(1);
		expect(agentCheckAll.disabled?.({ is: { checking: true } })).toBe(true);
		expect(agentCheckAll.disabled?.({ is: { nothingToCheck: true } })).toBe(true);
		expect(agentCheckAll.disabled?.({ is: {} })).toBe(false);
	});
});
