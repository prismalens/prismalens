// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardCardBody } from "./IncidentBoard";
import { IncidentRowBody } from "./IncidentListPane";

function makeIncident(number: number, title: string): IncidentWithRelations {
	return {
		id: `00000000-0000-0000-0000-00000000000${number}`,
		number,
		title,
		description: null,
		status: "investigating",
		severity: "critical",
		priority: "p1",
		serviceId: null,
		assignedToId: null,
		actualCause: null,
		actualCauseCategory: null,
		triggeredAt: "2026-10-02T12:00:00.000Z",
		acknowledgedAt: null,
		resolvedAt: null,
		customerImpact: null,
		correlationReason: null,
		tags: [],
		affectedSystems: [],
		timeToAcknowledge: null,
		timeToResolve: null,
		alertCount: 1,
		createdAt: "2026-10-02T12:00:00.000Z",
		updatedAt: "2026-10-02T12:00:00.000Z",
		investigations: [],
	} as IncidentWithRelations;
}

describe("Incident card and list identifiers (f19)", () => {
	it("renders INC-n before the title on board cards", () => {
		const incident = makeIncident(2, "BooklogrApiLatencyP99High");
		const html = renderToStaticMarkup(
			React.createElement(BoardCardBody, {
				incident,
				column: "needs_you",
				now: null,
			}),
		);

		expect(html).toContain("INC-2");
		const incIndex = html.indexOf("INC-2");
		const titleIndex = html.indexOf("BooklogrApiLatencyP99High");
		expect(incIndex).toBeGreaterThan(-1);
		expect(titleIndex).toBeGreaterThan(-1);
		expect(incIndex).toBeLessThan(titleIndex);
	});

	it("renders INC-n before the title in sidebar list rows", () => {
		const incident = makeIncident(6, "WalkGroupedCheck");
		const html = renderToStaticMarkup(
			React.createElement(IncidentRowBody, {
				incident,
				now: null,
				selected: false,
			}),
		);

		expect(html).toContain("INC-6");
		const incIndex = html.indexOf("INC-6");
		const titleIndex = html.indexOf("WalkGroupedCheck");
		expect(incIndex).toBeGreaterThan(-1);
		expect(titleIndex).toBeGreaterThan(-1);
		expect(incIndex).toBeLessThan(titleIndex);
	});
});
