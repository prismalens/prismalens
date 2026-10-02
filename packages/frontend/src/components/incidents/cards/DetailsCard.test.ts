// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailsCard } from "./DetailsCard";

type IncidentFixture = IncidentWithRelations & {
	service?: (NonNullable<IncidentWithRelations["service"]> & {
		integrations?: Array<{
			category?: string;
			templateId?: string;
			status?: string;
		}>;
	}) | null;
};

let mockIncident: IncidentFixture;

vi.mock("../record-context", () => ({
	useIncidentRecord: () => ({
		incident: mockIncident,
	}),
}));

vi.mock("@/hooks/use-now", () => ({
	useNow: () => Date.parse("2026-10-02T12:00:00.000Z"),
}));

function createIncident(serviceOverrides?: IncidentFixture["service"]): IncidentFixture {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		number: 1,
		title: "Test Incident",
		description: "Test description",
		status: "investigating",
		severity: "critical",
		priority: "p1",
		serviceId: "22222222-2222-4222-8222-222222222222",
		assignedToId: null,
		actualCause: null,
		actualCauseCategory: null,
		triggeredAt: "2026-10-02T11:00:00.000Z",
		acknowledgedAt: null,
		resolvedAt: null,
		customerImpact: null,
		correlationReason: null,
		tags: [],
		affectedSystems: [],
		timeToAcknowledge: null,
		timeToResolve: null,
		alertCount: 1,
		createdAt: "2026-10-02T11:00:00.000Z",
		updatedAt: "2026-10-02T11:00:00.000Z",
		service:
			serviceOverrides !== undefined
				? serviceOverrides
				: {
						id: "22222222-2222-4222-8222-222222222222",
						name: "api",
						displayName: "API Service",
						description: null,
						type: "service",
						tier: "tier_1",
						team: "core",
						slackChannel: null,
						tags: [],
						metadata: null,
						createdAt: "2026-10-02T10:00:00.000Z",
						updatedAt: "2026-10-02T10:00:00.000Z",
					},
	};
}

describe("DetailsCard metrics connection (f15)", () => {
	beforeEach(() => {
		mockIncident = createIncident();
	});

	it("does not show 'Metrics not connected' when service has linked metrics", () => {
		mockIncident = createIncident({
			id: "22222222-2222-4222-8222-222222222222",
			name: "api",
			displayName: "API Service",
			description: null,
			type: "service",
			tier: "tier_1",
			team: "core",
			slackChannel: null,
			tags: [],
			metadata: null,
			createdAt: "2026-10-02T10:00:00.000Z",
			updatedAt: "2026-10-02T10:00:00.000Z",
			integrations: [{ category: "metrics", templateId: "prometheus", status: "ACTIVE" }],
		});

		const html = renderToStaticMarkup(React.createElement(DetailsCard));
		expect(html).not.toContain("Metrics not connected");
	});

	it("shows 'Metrics not connected' when service integrations are known and none provide metrics", () => {
		mockIncident = createIncident({
			id: "22222222-2222-4222-8222-222222222222",
			name: "api",
			displayName: "API Service",
			description: null,
			type: "service",
			tier: "tier_1",
			team: "core",
			slackChannel: null,
			tags: [],
			metadata: null,
			createdAt: "2026-10-02T10:00:00.000Z",
			updatedAt: "2026-10-02T10:00:00.000Z",
			integrations: [{ category: "alerts", templateId: "alertmanager", status: "ACTIVE" }],
		});

		const html = renderToStaticMarkup(React.createElement(DetailsCard));
		expect(html).toContain("Metrics not connected");
	});

	it("drops 'Metrics not connected' rather than guessing when detail query has no integration data", () => {
		mockIncident = createIncident();
		const html = renderToStaticMarkup(React.createElement(DetailsCard));
		expect(html).not.toContain("Metrics not connected");
	});
});
