// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ImpactChart } from "@prismalens/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImpactCard } from "./ImpactCard";

const manual: ImpactChart = {
	incidentId: "00000000-0000-4000-8000-000000000001",
	alertId: null,
	state: "expression_unknown",
	expression: {
		state: "expression_unknown",
		reason: "this incident has no alert of its own",
	},
	checkable: false,
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
		alertCount: 0,
		refiresThisWeek: 0,
		strip: [],
	},
	linkOut: null,
	connection: null,
	error: null,
	capturedAt: "2026-10-13T00:00:00Z",
};

const view = (impact: ImpactChart) => ({
	impact,
	pending: false,
	slow: false,
	failed: null,
	firing: 0,
	retry: () => {},
});

describe("ImpactCard on a manual incident (#673 w8-17)", () => {
	it("says there is no alert instead of wording the card as one", () => {
		const html = renderToStaticMarkup(<ImpactCard view={view(manual)} />);
		expect(html).toContain("No alert on this incident");
		expect(html).toContain("No chart: this incident has no alert of its own.");
		for (const alertWords of [
			"From the alert alone",
			"Firing for",
			"Not firing",
			"When this alert fired",
		])
			expect(html).not.toContain(alertWords);
	});

	it("keeps the alert's history when the incident has an alert", () => {
		const html = renderToStaticMarkup(
			<ImpactCard
				view={view({
					...manual,
					history: { ...manual.history, alertCount: 1 },
				})}
			/>,
		);
		expect(html).toContain("From the alert alone");
		expect(html).toContain("When this alert fired, last 7 days");
	});
});
