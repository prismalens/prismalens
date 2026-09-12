// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, type TestingModule } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";
import { IncidentCorrelationService } from "./incident-correlation.service.js";

const mockAlertsService = {
	create: vi.fn(),
	findAll: vi.fn(),
	findById: vi.fn(),
	findUncorrelated: vi.fn(),
	getStats: vi.fn(),
	update: vi.fn(),
	acknowledge: vi.fn(),
	resolve: vi.fn(),
	delete: vi.fn(),
};

const mockIncidentCorrelationService = {
	correlateAlert: vi.fn(),
	resolveIncidentIfNoFiringAlerts: vi.fn(),
};

const now = new Date("2026-08-01T00:00:00.000Z");

function alertRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "00000000-0000-0000-0000-0000000000a1",
		dedupKey: "dedup-1",
		fingerprint: "fp-1",
		externalId: null,
		title: "Disk usage nominal",
		description: null,
		severity: "info",
		status: "suppressed",
		source: "prometheus",
		sourceUrl: null,
		serviceId: null,
		incidentId: null,
		tags: null,
		labels: null,
		triggeredAt: now,
		acknowledgedAt: null,
		resolvedAt: null,
		occurrenceCount: 1,
		lastOccurrence: now,
		rawPayload: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("AlertsController", () => {
	let controller: AlertsController;

	beforeEach(async () => {
		vi.clearAllMocks();

		const module: TestingModule = await Test.createTestingModule({
			controllers: [AlertsController],
			providers: [
				{ provide: AlertsService, useValue: mockAlertsService },
				{ provide: IncidentCorrelationService, useValue: mockIncidentCorrelationService },
			],
		}).compile();

		controller = module.get<AlertsController>(AlertsController);
	});

	// Unwrap oRPC ImplementedProcedure objects: each value is a DecoratedProcedure
	// whose actual handler function lives at ['~orpc'].handler
	function getHandlers(): any {
		const procedures = controller.alerts() as Record<string, any>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		);
	}

	describe("correlate (#608, C5 on #337: rule table and suppression are gone)", () => {
		it("short-circuits when the alert is already correlated: no IncidentCorrelationService call", async () => {
			const alert = alertRow({
				incidentId: "00000000-0000-0000-0000-0000000000b1",
				incident: { id: "00000000-0000-0000-0000-0000000000b1", number: 7 },
			});
			mockAlertsService.findById.mockResolvedValue(alert);

			const handlers = getHandlers();
			const result = await handlers.correlate({ input: { id: alert.id } } as any);

			expect(result.incidentId).toBe("00000000-0000-0000-0000-0000000000b1");
			expect(result.incidentNumber).toBe(7);
			expect(result.reason).toBe("Already correlated");
			expect(result.isNewIncident).toBe(false);
			expect(mockIncidentCorrelationService.correlateAlert).not.toHaveBeenCalled();
		});

		it("delegates to IncidentCorrelationService.correlateAlert when not yet correlated", async () => {
			const alert = alertRow();
			const correlated = alertRow({
				status: "correlated",
				incidentId: "00000000-0000-0000-0000-0000000000b1",
			});
			mockAlertsService.findById
				.mockResolvedValueOnce(alert)
				.mockResolvedValueOnce(correlated);
			mockIncidentCorrelationService.correlateAlert.mockResolvedValue({
				incidentId: "00000000-0000-0000-0000-0000000000b1",
				incidentNumber: 7,
				reason: "Created new incident",
				isNewIncident: true,
			});

			const handlers = getHandlers();
			const result = await handlers.correlate({
				input: { id: alert.id },
			} as any);

			expect(mockIncidentCorrelationService.correlateAlert).toHaveBeenCalledWith(alert);
			expect(result.incidentId).toBe("00000000-0000-0000-0000-0000000000b1");
			expect(result.incidentNumber).toBe(7);
			expect(result.isNewIncident).toBe(true);
		});

		it("throws NOT_FOUND for an unknown alert", async () => {
			mockAlertsService.findById.mockResolvedValue(null);

			const handlers = getHandlers();
			await expect(
				handlers.correlate({ input: { id: "missing" } } as any),
			).rejects.toThrow(ORPCError);
			expect(mockIncidentCorrelationService.correlateAlert).not.toHaveBeenCalled();
		});
	});

	describe("get — suppressedBy (#608: no rule table survives the correlation module deferral)", () => {
		it("always reports null — nothing can suppress an alert any more", async () => {
			const alert = alertRow({ status: "suppressed" });
			mockAlertsService.findById.mockResolvedValue(alert);

			const handlers = getHandlers();
			const result = await handlers.get({ input: { id: alert.id } } as any);

			expect(result.suppressedBy).toBeNull();
		});
	});

	describe("serializeAlert whitelist (#302 follow-up 4b)", () => {
		// serializeAlert used to spread the raw Prisma row, which put `tenantId`
		// (ADR-0011 §6's dormant multi-tenancy hedge) on the alert-detail response.
		// Whitelisting must keep it — and any other internal column — out even if the
		// procedure's `.output(...)` validation is ever loosened or bypassed.
		it("never leaks tenantId (or other non-contract columns) on GET /alerts/:id", async () => {
			const alert = alertRow({
				status: "triggered",
				title: "High CPU",
				severity: "critical",
				// Internal-only columns that must never reach the API response.
				tenantId: "tenant-secret-123",
				internalNotes: "do-not-leak",
			});
			mockAlertsService.findById.mockResolvedValue(alert);

			const handlers = getHandlers();
			const result = await handlers.get({ input: { id: alert.id } } as any);

			expect(result).not.toHaveProperty("tenantId");
			expect(result).not.toHaveProperty("internalNotes");
			// Sanity: the whitelist still carries every contract-required field.
			expect(result).toMatchObject({
				id: alert.id,
				dedupKey: "dedup-1",
				title: "High CPU",
				severity: "critical",
				status: "triggered",
				occurrenceCount: 1,
			});
		});
	});
});
