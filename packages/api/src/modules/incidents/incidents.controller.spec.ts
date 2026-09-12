// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import type { HarnessSelection } from "@prismalens/config/harness-selection";
import { describe, expect, it, vi } from "vitest";
import type { HarnessService } from "../../core/harness/harness.service.js";
import type { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { InvestigationsService } from "../investigations/investigations.service.js";
import { IncidentsController } from "./incidents.controller.js";
import type { IncidentsService } from "./incidents.service.js";

describe("IncidentsController - storm path alert serialization", () => {
	function getHandlers(controller: IncidentsController) {
		const procedures = controller.incidents() as unknown as Record<
			string,
			{ "~orpc"?: { handler: (args: { input: unknown }) => Promise<unknown> } }
		>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		) as Record<
			string,
			(args: { input: { id: string } }) => Promise<Record<string, unknown>>
		>;
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

		const harnessService = {
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: true,
				harness: "deepagents",
				verified: true,
				auto: true,
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);

		// Test get incident endpoint
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.alerts).toHaveLength(2);
		expect((result.alerts as Record<string, unknown>[])?.[0]?.labels).toEqual({
			service: "checkout",
			environment: "prod",
		});
		expect((result.alerts as Record<string, unknown>[])?.[1]?.labels).toEqual({
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
			incidentsService as unknown as IncidentsService,
			{} as unknown as InvestigationsService,
			{} as unknown as DispatchService,
			{} as unknown as IntegrationsService,
			{} as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.alerts).toHaveLength(1);
		expect(
			(result.alerts as Record<string, unknown>[])?.[0],
		).not.toHaveProperty("tenantId");
		expect(
			(result.alerts as Record<string, unknown>[])?.[0],
		).not.toHaveProperty("internalNotes");
	});
});

describe("IncidentsController - investigate runnability gate (#520)", () => {
	function getHandlers(controller: IncidentsController) {
		const procedures = controller.incidents() as unknown as Record<
			string,
			{ "~orpc"?: { handler: (args: { input: unknown }) => Promise<unknown> } }
		>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		) as Record<
			string,
			(args: { input: { id: string } }) => Promise<Record<string, unknown>>
		>;
	}

	const mockIncident = {
		id: "123e4567-e89b-12d3-a456-426614174000",
		number: 42,
		title: "Database Outage",
		severity: "critical",
		status: "triggered",
		priority: "p1",
		serviceId: "srv-123",
		triggeredAt: new Date("2026-08-30T10:00:00Z"),
		createdAt: new Date("2026-08-30T10:00:00Z"),
		updatedAt: new Date("2026-08-30T10:00:00Z"),
		alertCount: 1,
	};

	it("happy path: usable harness flips incident to investigating and enqueues job", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({ ...mockIncident, status: "investigating" }),
		};
		const investigationsService = {
			create: vi.fn().mockResolvedValue({ id: "inv-456" }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: true,
				harness: "deepagents",
				verified: true,
				auto: true,
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.investigate({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result).toEqual({
			incidentId: "123e4567-e89b-12d3-a456-426614174000",
			investigationId: "inv-456",
			jobId: "job-789",
			queued: true,
		});

		// Status flipped to investigating
		expect(incidentsService.update).toHaveBeenCalledTimes(1);
		expect(incidentsService.update).toHaveBeenCalledWith(
			"123e4567-e89b-12d3-a456-426614174000",
			{ status: "investigating" },
		);

		// Investigation created and job enqueued
		expect(investigationsService.create).toHaveBeenCalledTimes(1);
		expect(dispatchService.addInvestigationJob).toHaveBeenCalledTimes(1);
	});

	it("refuses with PRECONDITION_FAILED when no harness is on PATH: status UNCHANGED and no job enqueued", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({}),
		};
		const investigationsService = {
			create: vi.fn().mockResolvedValue({ id: "inv-456" }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: false,
				failure: "no-harness",
				reason:
					"No coding agent found on PATH. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash.",
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "123e4567-e89b-12d3-a456-426614174000" },
			});
		} catch (err) {
			thrown = err;
		}

		// 1. Returns typed refusal
		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { failure: string; reason: string; harness?: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.status).toBe(412);
		expect(orpcErr.data).toEqual({
			failure: "no-harness",
			reason:
				"No coding agent found on PATH. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash.",
			harness: undefined,
		});

		// 2. Incident status is UNCHANGED
		expect(incidentsService.update).not.toHaveBeenCalled();

		// 3. No job was enqueued and no investigation was created
		expect(investigationsService.create).not.toHaveBeenCalled();
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("refuses with PRECONDITION_FAILED on a pinned-but-missing harness: status UNCHANGED and no job enqueued", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({}),
		};
		const investigationsService = {
			create: vi.fn().mockResolvedValue({ id: "inv-456" }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: false,
				failure: "pinned-harness-missing",
				harness: "deepagents",
				reason:
					'PRISMALENS_HARNESS="deepagents" but deepagents-acp is not on PATH. Install: pip install deepagents-acp',
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "123e4567-e89b-12d3-a456-426614174000" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { failure: string; reason: string; harness?: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.status).toBe(412);
		expect(orpcErr.data.failure).toBe("pinned-harness-missing");
		expect(orpcErr.data.harness).toBe("deepagents");

		expect(incidentsService.update).not.toHaveBeenCalled();
		expect(investigationsService.create).not.toHaveBeenCalled();
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("refuses with PRECONDITION_FAILED on an invalid PRISMALENS_HARNESS pin: status UNCHANGED and no job enqueued", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({}),
		};
		const investigationsService = {
			create: vi.fn().mockResolvedValue({ id: "inv-456" }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: false,
				failure: "invalid-env-harness",
				reason:
					'PRISMALENS_HARNESS="bogus" is not a known harness (opencode, claude-code, codex, gemini, deepagents)',
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "123e4567-e89b-12d3-a456-426614174000" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { failure: string; reason: string; harness?: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.status).toBe(412);
		expect(orpcErr.data.failure).toBe("invalid-env-harness");
		expect(orpcErr.data.harness).toBeUndefined();

		expect(incidentsService.update).not.toHaveBeenCalled();
		expect(investigationsService.create).not.toHaveBeenCalled();
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
	});

	it("throws NOT_FOUND when incident does not exist", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(null),
			update: vi.fn().mockResolvedValue({}),
		};
		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			{} as unknown as InvestigationsService,
			{} as unknown as DispatchService,
			{} as unknown as IntegrationsService,
			{} as unknown as HarnessService,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "non-existent-id" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"NOT_FOUND", unknown>;
		expect(orpcErr.code).toBe("NOT_FOUND");
		expect(orpcErr.status).toBe(404);
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
			{} as unknown as HarnessService,
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
