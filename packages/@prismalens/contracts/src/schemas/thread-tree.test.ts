// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	ProposalChangeSchema,
	THREAD_TREE_DEFAULTS,
	THREAD_TREE_RANGES,
	ThreadTreeSettingsSchema,
} from "./thread-tree.js";

const setting = (key: string, value: string | number) => ({
	kind: "setting" as const,
	key,
	value,
});

describe("a proposal to change a threads setting", () => {
	it("takes every value the setting itself takes, bounds included", () => {
		for (const [key, { min, max }] of Object.entries(THREAD_TREE_RANGES)) {
			expect(ProposalChangeSchema.safeParse(setting(key, min)).success).toBe(true);
			expect(ProposalChangeSchema.safeParse(setting(key, max)).success).toBe(true);
		}
		expect(ProposalChangeSchema.safeParse(setting("turnsPerDay", 200)).success).toBe(true);
		expect(ProposalChangeSchema.safeParse(setting("pairPerDay", 200)).success).toBe(true);
	});

	it("refuses a value outside the setting's range, naming the range", () => {
		const bad = ProposalChangeSchema.safeParse(setting("turnsPerDay", 1001));
		expect(bad.success).toBe(false);
		expect(bad.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
			["value", "turnsPerDay takes a value from 10 to 1000."],
		]);
		const low = ProposalChangeSchema.safeParse(setting("children", 0));
		expect(low.error?.issues.map((i) => i.message)).toEqual([
			"children takes a value from 1 to 20.",
		]);
		const pair = ProposalChangeSchema.safeParse(setting("pairPerDay", 201));
		expect(pair.error?.issues.map((i) => i.message)).toEqual([
			"pairPerDay takes a value from 2 to 200.",
		]);
	});

	it("still takes a word for agentsStartThreads", () => {
		expect(
			ProposalChangeSchema.safeParse(setting("agentsStartThreads", "ask")).success,
		).toBe(true);
	});

	it("keeps the settings schema on the same ranges, defaults included", () => {
		expect(ThreadTreeSettingsSchema.safeParse(THREAD_TREE_DEFAULTS).success).toBe(true);
		const max = {
			...THREAD_TREE_DEFAULTS,
			turnsPerDay: THREAD_TREE_RANGES.turnsPerDay.max,
			pairPerDay: THREAD_TREE_RANGES.pairPerDay.max,
		};
		expect(ThreadTreeSettingsSchema.safeParse(max).success).toBe(true);
		expect(
			ThreadTreeSettingsSchema.safeParse({
				...THREAD_TREE_DEFAULTS,
				pairPerDay: THREAD_TREE_RANGES.pairPerDay.max + 1,
			}).success,
		).toBe(false);
	});
});
