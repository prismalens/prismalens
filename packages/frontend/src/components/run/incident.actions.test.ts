// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import {
	type IncidentCtx,
	incidentDetails,
	incidentResolve,
	incidentRuns,
	incidentSeverityHigh,
	incidentSeverityLow,
} from "./incident.actions";
import { incidentHeader } from "./incident.surface";

const ctx = (over: Partial<IncidentCtx> = {}): IncidentCtx =>
	({
		severity: "high",
		detailsLabel: "Run details",
		toggleDetails: vi.fn(),
		setSeverity: vi.fn(),
		facts: { is: { hasRun: true, detailsOpen: true } },
		...over,
	}) as unknown as IncidentCtx;

describe("an incident page's ⋯ (#1101: only status and the primary action stay in sight)", () => {
	it("holds the details toggle, ticked while the panel is open", () => {
		const c = ctx();
		expect(incidentDetails.checked?.(c)).toBe(true);
		incidentDetails.run(c);
		expect(c.toggleDetails).toHaveBeenCalledTimes(1);
	});

	it("lists All runs only when there is more than one run", () => {
		expect(incidentRuns.when?.({ is: { manyRuns: true } })).toBe(true);
		expect(incidentRuns.when?.({ is: {} })).toBe(false);
	});

	it("offers Resolve only on a resolvable incident", () => {
		expect(incidentResolve.when?.({ is: { resolvable: true } })).toBe(true);
		expect(incidentResolve.when?.({ is: { chat: true } })).toBe(false);
	});

	it("ticks the current severity and sets another", () => {
		const c = ctx();
		expect(incidentSeverityHigh.checked?.(c)).toBe(true);
		expect(incidentSeverityLow.checked?.(c)).toBe(false);
		incidentSeverityLow.run(c);
		expect(c.setSeverity).toHaveBeenCalledWith("low");
	});

	it("puts the same rows in ⋯ and on right-click", () => {
		expect(incidentHeader.menus.context).toEqual(incidentHeader.menus.more);
		expect(incidentHeader.menus.more?.slice(0, 3)).toEqual([
			"incident.details",
			"incident.runs",
			"incident.newConversation",
		]);
	});
});
