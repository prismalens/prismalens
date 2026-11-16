// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { allSettings } from "@/components/kit/registry";
import { SETTINGS_SECTIONS } from "./SettingsFrame";
import { searchSettings, settingRows } from "./settings-search";

describe("settings search, read from the registry", () => {
	it("ranks the Models page's New thread first for 'model'", () => {
		expect(searchSettings("model")[0]?.name).toBe("New thread");
	});

	it("needs every word of a multi-word query", () => {
		expect(searchSettings("alert webhook").map((r) => r.name)).toEqual(["Alert webhooks"]);
		expect(searchSettings("alert nonexistingwordxyz")).toEqual([]);
	});

	it("returns nothing for an empty query", () => {
		expect(searchSettings("")).toEqual([]);
		expect(searchSettings("   ")).toEqual([]);
	});

	it("lists every registered setting, the moved sub-agent rows included, and the keys", () => {
		const anchors = settingRows().map((r) => r.anchor);
		expect(anchors).toContain("harness-subagents-stop-row");
		expect(anchors).toContain("agent-threads-pairPerDay-row");
		expect(anchors).toContain("shortcut-app.search");
		expect(settingRows().filter((r) => r.tab !== "shortcuts")).toHaveLength(allSettings().length);
	});

	it("puts every registered setting on a page Settings has", () => {
		const tabs = new Set<string>(SETTINGS_SECTIONS.map((s) => s.tab));
		expect(allSettings().filter((s) => !tabs.has(s.page)).map((s) => s.id)).toEqual([]);
	});
});
