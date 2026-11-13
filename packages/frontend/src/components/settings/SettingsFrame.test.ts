// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	listedIntegrations,
	navOf,
	SETTINGS_NAV,
	SETTINGS_SECTIONS,
} from "./SettingsFrame";

const holder = { id: "i1", templateId: "git-host-token", label: "Git host token" };
const prom = { id: "i2", templateId: "prometheus", label: "lab" };
const slackish = { id: "i3", templateId: "other", label: "Other" };

describe("SETTINGS_SECTIONS (case 1)", () => {
	it("lists the fifteen pages in exact order with no line under any", () => {
		expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
			"General",
			"Models",
			"Permissions",
			"Organizer limits",
			"Agents",
			"Appearance",
			"Notifications",
			"Keyboard shortcuts",
			"Usage",
			"Runs",
			"Alert intake",
			"Sources",
			"Devices",
			"Usage data",
			"About",
		]);
		expect(SETTINGS_SECTIONS.map((s) => s.tab)).toEqual([
			"general",
			"models",
			"permissions",
			"organizer",
			"agent",
			"appearance",
			"notifications",
			"shortcuts",
			"usage",
			"runs",
			"alert-intake",
			"sources",
			"devices",
			"telemetry",
			"about",
		]);
		for (const s of SETTINGS_SECTIONS) {
			expect("line" in s).toBe(false);
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

describe("the folded settings list (#1101 cat 18)", () => {
	// 21afc7098 gave Models and Shortcuts their own entries.
	it("lists eleven entries beside each page", () => {
		expect(SETTINGS_NAV.map((n) => n.label)).toEqual([
			"General",
			"Agents",
			"Models",
			"Appearance",
			"Shortcuts",
			"Notifications",
			"Usage",
			"Alert intake",
			"Sources",
			"Devices",
			"About",
		]);
	});

	it("keeps every page reachable under exactly one entry", () => {
		for (const s of SETTINGS_SECTIONS) {
			const under = SETTINGS_NAV.filter(
				(n) => n.tab === s.tab || n.pages?.includes(s.tab),
			);
			expect([s.tab, under.length]).toEqual([s.tab, 1]);
		}
	});

	it("files Permissions, Limits and Runs under Agents, Models and Shortcuts on their own, and Usage data under About", () => {
		expect(navOf("permissions")?.label).toBe("Agents");
		expect(navOf("organizer")?.label).toBe("Agents");
		expect(navOf("runs")?.label).toBe("Agents");
		expect(navOf("models")?.label).toBe("Models");
		expect(navOf("shortcuts")?.label).toBe("Shortcuts");
		expect(navOf("telemetry")?.label).toBe("About");
		expect(navOf("general")?.pages).toBeUndefined();
	});
});
