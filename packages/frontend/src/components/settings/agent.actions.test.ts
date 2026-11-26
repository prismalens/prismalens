// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { runAction } from "@/components/kit/registry";

describe("agent.actions.ts", () => {
	it("agent.checkAll, run through the registry, runs the list's Check all, and not while checking or with nothing to check", () => {
		const ctx = (is: Record<string, boolean>) => {
			const checkAll = vi.fn();
			const none = vi.fn();
			const ran = runAction("agent.checkAll", {
				update: none,
				signOut: none,
				changeAccount: none,
				updateAll: none,
				checkAll,
				facts: { is },
			});
			return [ran, checkAll.mock.calls.length, none.mock.calls.length];
		};
		expect([ctx({}), ctx({ checking: true }), ctx({ nothingToCheck: true })]).toEqual([
			[true, 1, 0],
			[false, 0, 0],
			[false, 0, 0],
		]);
	});
});
