// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "./SettingsFrame";
import { searchSettings, SETTINGS_INDEX } from "./settings-index";

describe("settings-index", () => {
	it("searchSettings('model') returns New thread first", () => {
		const results = searchSettings("model");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.name).toBe("New thread");
	});

	it("multi-word queries need every word", () => {
		// "alert webhook" matches Alert webhook
		const webhookResults = searchSettings("alert webhook");
		expect(webhookResults.length).toBe(1);
		expect(webhookResults[0]?.name).toBe("Alert webhook");

		// "alert nonexistingwordxyz" matches nothing
		const noResults = searchSettings("alert nonexistingwordxyz");
		expect(noResults).toEqual([]);
	});

	it("an empty query returns []", () => {
		expect(searchSettings("")).toEqual([]);
		expect(searchSettings("   ")).toEqual([]);
	});

	it("every SETTINGS_INDEX entry's tab is in SETTINGS_SECTIONS", () => {
		const validTabs = new Set(SETTINGS_SECTIONS.map((s) => s.tab));
		for (const entry of SETTINGS_INDEX) {
			expect(validTabs.has(entry.tab)).toBe(true);
		}
	});
});
