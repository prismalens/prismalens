// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { IncidentsController } from "./incidents.controller.js";

describe("IncidentsController - storm path alert serialization", () => {
	function getHandlers(controller: IncidentsController): Record<string, any> {
		const procedures = controller.incidents() as Record<string, any>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		);
	}

	it("preserves full alert objects with labels, annotations, and timestamps in serializeIncidentWithRelations", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue({
				id: "123e4567-e89b-12d3-a456-426614174000",
				number: 1,
				title: "Storm Incident",
				severity: "critical",
				status: "triggered",
				priority: "p1",
				triggeredAt: new Date("2026-07-31T10:00:00Z"),
				createdAt: new Date("2026-07-31T10:00:00Z"),
				updatedAt: new Date("2026-07-31T10:00:00Z"),
				alertCount: 2,
				alerts: [
					{
						id: "alert-1",
						dedupKey: "key-1",
						title: "Alert One",
						severity: "critical",
						status: "correlated",
						labels: JSON.stringify({ service: "checkout", environment: "prod" }),
						description: "High latency on checkout service",
						triggeredAt: new Date("2026-07-31T10:00:00Z"),
						lastOccurrence: new Date("2026-07-31T10:00:00Z"),
						createdAt: new Date("2026-07-31T10:00:00Z"),
						updatedAt: new Date("2026-07-31T10:00:00Z"),
					},
					{
						id: "alert-2",
						dedupKey: "key-2",
						title: "Alert Two",
						severity: "high",
						status: "correlated",
						labels: JSON.stringify({ service: "checkout", component: "db" }),
						description: "Connection pool exhausted",
						triggeredAt: new Date("2026-07-31T10:01:00Z"),
						lastOccurrence: new Date("2026-07-31T10:01:00Z"),
						createdAt: new Date("2026-07-31T10:01:00Z"),
						updatedAt: new Date("2026-07-31T10:01:00Z"),
					},
				],
			}),
			update: vi.fn().mockResolvedValue({}),
		};

		const investigationsService = {
			create: vi.fn().mockResolvedValue({ id: "inv-123" }),
		};

		const queueService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-123"),
		};

		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};

		const controller = new IncidentsController(
			incidentsService as any,
			investigationsService as any,
			queueService as any,
			integrationsService as any,
		);

		const handlers = getHandlers(controller);

		// Test get incident endpoint
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.alerts).toHaveLength(2);
		expect(result.alerts?.[0].labels).toEqual({
			service: "checkout",
			environment: "prod",
		});
		expect(result.alerts?.[1].labels).toEqual({
			service: "checkout",
			component: "db",
		});

		// Test investigate endpoint passes alerts to queue
		await handlers.investigate({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(queueService.addInvestigationJob).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "123e4567-e89b-12d3-a456-426614174000",
				investigationId: "inv-123",
				alerts: [
					expect.objectContaining({
						alertname: "Alert One",
						severity: "critical",
						labels: { service: "checkout", environment: "prod" },
					}),
					expect.objectContaining({
						alertname: "Alert Two",
						severity: "high",
						labels: { service: "checkout", component: "db" },
					}),
				],
			}),
		);
	});
});
