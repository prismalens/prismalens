// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Reading an overlay written by an earlier build (#338, #667 review).
 *
 * `similarIncidents` changed shape, so those rows fail `OverlaySchema`. What
 * matters is that the *rest* of the overlay survives: `computeOverlay` runs
 * only when an investigation completes, so an investigation that finished
 * before the upgrade never recomputes, and an all-or-nothing parse would empty
 * its Analysis tab permanently rather than briefly. 0.5.0 is published, so
 * these rows exist on real installs.
 */

import { describe, expect, it } from "vitest";
import { InvestigationsController } from "./investigations.controller.js";

/** The private reader, exercised directly — it is the whole subject here. */
const parseOverlay = (raw: string | null) =>
	(
		Object.getPrototypeOf(
			Object.create(InvestigationsController.prototype),
		) as {
			parseOverlay: (raw: string | null) => unknown;
		}
	).parseOverlay.call({}, raw);

const MATCHED_CHANGE = {
	kind: "deployment",
	id: "dep-1",
	title: "deploy 41",
	source: "render",
	serviceName: "checkout",
	timestamp: "2026-08-31T23:00:00.000Z",
	hypothesisIndex: 0,
	matchedOn: "checkout",
};

const SERVICE_PROXIMITY = {
	serviceName: "checkout",
	proximity: 0,
	relation: "self",
	hypothesisIndexes: [0],
};

const LEGACY_SIMILAR = {
	incidentId: "inc-9",
	incidentNumber: 9,
	title: "Checkout latency",
	score: 0.82,
	factors: { labels: 0.5, service: 0.2, category: 0.12 },
};

const overlay = (similarIncidents: unknown[]) =>
	JSON.stringify({
		matchedChanges: [],
		serviceProximity: [],
		similarIncidents,
		computedAt: "2026-09-01T00:00:00.000Z",
	});

describe("parseOverlay", () => {
	it("reads a current overlay unchanged", () => {
		const current = overlay([
			{
				incidentId: "inc-9",
				incidentNumber: 9,
				title: "Checkout latency",
				rank: 1,
				matchedOn: ["same service"],
				actualCause: null,
			},
		]);
		expect(parseOverlay(current)).toMatchObject({
			similarIncidents: [{ rank: 1 }],
			computedAt: "2026-09-01T00:00:00.000Z",
		});
	});

	it("keeps the rest of an overlay whose similar incidents are the old shape", () => {
		const legacy = JSON.stringify({
			matchedChanges: [MATCHED_CHANGE],
			serviceProximity: [SERVICE_PROXIMITY],
			similarIncidents: [LEGACY_SIMILAR],
			computedAt: "2026-09-01T00:00:00.000Z",
		});

		const parsed = parseOverlay(legacy) as {
			matchedChanges: unknown[];
			serviceProximity: unknown[];
			similarIncidents: unknown[];
		} | null;

		// The half that did not change must survive: nothing recomputes it.
		expect(parsed).not.toBe(null);
		expect(parsed?.matchedChanges).toHaveLength(1);
		expect(parsed?.serviceProximity).toHaveLength(1);
		// The stale section is dropped, not shown in its old shape.
		expect(parsed?.similarIncidents).toEqual([]);
	});

	it("is null when the overlay is not an object or is unsalvageable", () => {
		expect(parseOverlay(null)).toBe(null);
		expect(parseOverlay("not json")).toBe(null);
		expect(parseOverlay(JSON.stringify({ matchedChanges: "nope" }))).toBe(null);
	});
});
