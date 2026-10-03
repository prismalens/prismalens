// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { backTarget, inAlertRecord, inIncident, inSettings } from "./use-back";

const at = (...hrefs: string[]) =>
	hrefs.map((href) => ({ href, pathname: href.split("?")[0] ?? href }));

describe("backTarget", () => {
	it("an alert opened from an incident's Alerts tab goes back to that tab", () => {
		const trail = at("/incidents/1", "/incidents/1/alerts", "/alerts/a");
		expect(backTarget(inAlertRecord, "/alerts", trail)).toBe(
			"/incidents/1/alerts",
		);
	});

	it("an alert opened from the list goes back to the list, past sibling alerts", () => {
		const trail = at("/alerts?tab=unmapped", "/alerts/a", "/alerts/b");
		expect(backTarget(inAlertRecord, "/alerts", trail)).toBe(
			"/alerts?tab=unmapped",
		);
	});

	it("a deep link with no history falls back to the list", () => {
		expect(backTarget(inIncident("1"), "/incidents", at("/incidents/1/report"))).toBe(
			"/incidents",
		);
	});

	it("an incident's tabs are not levels", () => {
		const trail = at("/alerts", "/incidents/1", "/incidents/1/report");
		expect(backTarget(inIncident("1"), "/incidents", trail)).toBe("/alerts");
		expect(inIncident("1")("/incidents/12")).toBe(false);
	});

	it("Settings goes back to where it was opened from, else the board", () => {
		const trail = at("/incidents/1", "/settings", "/settings?tab=devices");
		expect(backTarget(inSettings, "/incidents", trail)).toBe("/incidents/1");
		expect(backTarget(inSettings, "/incidents", at("/settings?tab=devices"))).toBe(
			"/incidents",
		);
	});
});
