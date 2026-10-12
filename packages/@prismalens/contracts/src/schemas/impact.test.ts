// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { ImpactChartSchema } from "./impact";

const older = {
	incidentId: "00000000-0000-4000-8000-000000000001",
	alertId: null,
	state: "not_configured",
	expression: { state: "not_configured", reason: null },
	metric: null,
	scope: { state: "unscoped", matched: 0 },
	series: [],
	window: { start: "2026-10-12T00:00:00Z", end: "2026-10-13T00:00:00Z" },
	stepSeconds: 60,
	now: null,
	usual: null,
	deploys: [],
	history: {
		firingSince: null,
		resolvedAt: null,
		alertCount: 1,
		refiresThisWeek: 0,
		strip: [],
	},
	linkOut: null,
	connection: null,
	error: null,
	capturedAt: "2026-10-13T00:00:00Z",
};

describe("ImpactChartSchema (#834 review)", () => {
	it("reads a response from before `checkable` as not checkable", () => {
		const parsed = ImpactChartSchema.parse(older);
		expect(parsed.checkable).toBe(false);
	});
});
