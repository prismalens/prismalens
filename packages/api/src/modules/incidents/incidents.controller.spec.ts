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

		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-123"),
		};

		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};

		const controller = new IncidentsController(
			incidentsService as any,
			investigationsService as any,
			dispatchService as any,
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

		// Test investigate endpoint passes alerts into the job payload
		await handlers.investigate({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(dispatchService.addInvestigationJob).toHaveBeenCalledWith(
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

	// Follow-up 4b, issue #302: serializeAlert used to spread the raw Prisma
	// row, which put `tenantId` (ADR-0011 §6's dormant multi-tenancy hedge) on
	// the incident-detail response. Whitelisting must keep it out even if oRPC
	// output validation is ever loosened or bypassed — defense in depth.
	it("never leaks tenantId (or other non-contract columns) via serializeAlert", async () => {
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
				alertCount: 1,
				alerts: [
					{
						id: "alert-1",
						dedupKey: "key-1",
						title: "Alert One",
						severity: "critical",
						status: "correlated",
						labels: JSON.stringify({ service: "checkout" }),
						description: "High latency on checkout service",
						triggeredAt: new Date("2026-07-31T10:00:00Z"),
						lastOccurrence: new Date("2026-07-31T10:00:00Z"),
						createdAt: new Date("2026-07-31T10:00:00Z"),
						updatedAt: new Date("2026-07-31T10:00:00Z"),
						// Internal-only columns that must never reach the API response.
						tenantId: "tenant-secret-123",
						internalNotes: "do-not-leak",
					},
				],
			}),
			update: vi.fn().mockResolvedValue({}),
		};

		const controller = new IncidentsController(
			incidentsService as any,
			{} as any,
			{} as any,
			{} as any,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.alerts).toHaveLength(1);
		expect(result.alerts?.[0]).not.toHaveProperty("tenantId");
		expect(result.alerts?.[0]).not.toHaveProperty("internalNotes");
	});

	// Task #532: serializeIncidentWithRelations previously spread `incident.service`,
	// leaking `tenantId`, `discoveryMetadata`, and any raw Prisma columns.
	it("never leaks tenantId, discoveryMetadata, or extra database columns on incident.service via get handler", async () => {
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
				alertCount: 0,
				service: {
					id: "22222222-2222-4222-8222-222222222222",
					name: "checkout-service",
					displayName: "Checkout Service",
					description: "Processes checkout transactions",
					type: "service",
					tier: "tier_1",
					team: "payments",
					slackChannel: "#payments-alerts",
					tags: JSON.stringify(["tier1", "pci"]),
					metadata: JSON.stringify({ repo: "org/checkout" }),
					localCheckoutPath: "/home/user/checkout",
					createdAt: new Date("2026-07-31T10:00:00Z"),
					updatedAt: new Date("2026-07-31T10:00:00Z"),
					// Internal / unwhitelisted columns
					tenantId: "tenant-secret-service-456",
					discoveryMetadata: JSON.stringify({ autoDiscovered: true }),
					internalSecret: "do-not-leak-service-secret",
				},
			}),
			update: vi.fn().mockResolvedValue({}),
		};

		const controller = new IncidentsController(
			incidentsService as any,
			{} as any,
			{} as any,
			{} as any,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.service).toBeDefined();
		expect(result.service).not.toHaveProperty("tenantId");
		expect(result.service).not.toHaveProperty("discoveryMetadata");
		expect(result.service).not.toHaveProperty("internalSecret");
		expect(Object.keys(result.service!).sort()).toEqual(
			[
				"createdAt",
				"description",
				"displayName",
				"id",
				"localCheckoutPath",
				"metadata",
				"name",
				"slackChannel",
				"tags",
				"team",
				"tier",
				"type",
				"updatedAt",
			].sort(),
		);
	});
});
