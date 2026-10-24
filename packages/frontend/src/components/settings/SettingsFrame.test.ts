// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, listedIntegrations } from "./SettingsFrame";

const holder = { id: "i1", templateId: "git-host-token", label: "Git host token" };
const prom = { id: "i2", templateId: "prometheus", label: "lab" };
const slackish = { id: "i3", templateId: "other", label: "Other" };

describe("SETTINGS_SECTIONS (case 1)", () => {
	it("lists the nine pages in exact order with no line under any", () => {
		expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
			"General",
			"Appearance",
			"Agent",
			"Alert intake",
			"Sources",
			"Notifications",
			"Devices",
			"Usage data",
			"About",
		]);
		expect(SETTINGS_SECTIONS.map((s) => s.tab)).toEqual([
			"general",
			"appearance",
			"agent",
			"alert-intake",
			"sources",
			"notifications",
			"devices",
			"usage",
			"about",
		]);
		for (const s of SETTINGS_SECTIONS) {
			expect((s as Record<string, unknown>).line).toBeUndefined();
		}
	});
});

describe("listedIntegrations (w8-5)", () => {
	it("drops the token holder once its last token is removed", () => {
		expect(listedIntegrations([holder, prom, slackish], [])).toEqual([
			slackish,
		]);
	});

	it("lists the token holder while it holds a token", () => {
		expect(listedIntegrations([holder], [{ integrationId: "i1" }])).toEqual([
			holder,
		]);
	});
});
