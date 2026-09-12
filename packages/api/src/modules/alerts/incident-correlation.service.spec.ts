// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Alert } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IncidentsService } from "../incidents/incidents.service.js";
import { IncidentCorrelationService } from "./incident-correlation.service.js";

// Mock PrismaService to avoid Prisma import.meta issues, same pattern as
// alerts.service.spec.ts.
const mockPrismaService = {
	alert: {
		findFirst: vi.fn(),
		count: vi.fn(),
	},
	incident: {
		findUnique: vi.fn(),
	},
};

const mockIncidentsService = {
	create: vi.fn(),
	addAlert: vi.fn(),
	resolve: vi.fn(),
};

const mockEventEmitter = {
	emit: vi.fn(),
};

function alertRow(overrides: Partial<Alert> = {}): Alert {
	return {
		id: "alert-1",
		tenantId: null,
		dedupKey: "dedup-1",
		fingerprint: "fp-1",
		externalId: null,
		title: "High error rate",
		description: null,
		severity: "high",
		status: "triggered",
		source: "prometheus",
		sourceUrl: null,
		serviceId: null,
		tags: null,
		labels: null,
		triggeredAt: new Date("2026-09-11T00:00:00.000Z"),
		acknowledgedAt: null,
		resolvedAt: null,
		occurrenceCount: 1,
		lastOccurrence: new Date("2026-09-11T00:00:00.000Z"),
		rawPayload: null,
		createdAt: new Date("2026-09-11T00:00:00.000Z"),
		updatedAt: new Date("2026-09-11T00:00:00.000Z"),
		incidentId: null,
		...overrides,
	} as Alert;
}

describe("IncidentCorrelationService", () => {
	let service: IncidentCorrelationService;

	beforeEach(async () => {
		vi.clearAllMocks();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IncidentCorrelationService,
				{ provide: PrismaService, useValue: mockPrismaService },
				{ provide: IncidentsService, useValue: mockIncidentsService },
				{ provide: EventEmitter2, useValue: mockEventEmitter },
			],
		}).compile();

		service = module.get<IncidentCorrelationService>(
			IncidentCorrelationService,
		);
	});

	describe("correlateAlert", () => {
		it("opens a new incident when nothing matches the fingerprint", async () => {
			const alert = alertRow({ id: "alert-1", fingerprint: "fp-new" });
			mockPrismaService.alert.findFirst.mockResolvedValue(null);
			mockIncidentsService.create.mockResolvedValue({
				id: "incident-1",
				number: 1,
			});

			const result = await service.correlateAlert(alert);

			expect(mockIncidentsService.create).toHaveBeenCalledTimes(1);
			expect(mockIncidentsService.addAlert).toHaveBeenCalledWith(
				"incident-1",
				"alert-1",
			);
			expect(result).toEqual({
				incidentId: "incident-1",
				incidentNumber: 1,
				isNewIncident: true,
				reason: "Created new incident",
			});
			expect(mockEventEmitter.emit).toHaveBeenCalledWith(
				"alert.correlated",
				{ alertId: "alert-1", incidentId: "incident-1", isNewIncident: true },
			);
		});

		it("does not re-emit alert.correlated for an alert that was already correlated", async () => {
			const alert = alertRow({
				id: "alert-1",
				incidentId: "incident-1",
			});
			mockPrismaService.incident.findUnique.mockResolvedValue({
				id: "incident-1",
				number: 1,
			});

			await service.correlateAlert(alert);

			expect(mockEventEmitter.emit).not.toHaveBeenCalled();
		});

		it("attaches a second alert with the same fingerprint to the open incident instead of opening another", async () => {
			const first = alertRow({ id: "alert-1", fingerprint: "fp-shared" });
			const second = alertRow({ id: "alert-2", fingerprint: "fp-shared" });

			mockPrismaService.alert.findFirst.mockResolvedValue({
				...first,
				incidentId: "incident-1",
				incident: { id: "incident-1", number: 1, status: "triggered" },
			});

			const result = await service.correlateAlert(second);

			expect(mockIncidentsService.create).not.toHaveBeenCalled();
			expect(mockIncidentsService.addAlert).toHaveBeenCalledWith(
				"incident-1",
				"alert-2",
			);
			expect(result).toEqual({
				incidentId: "incident-1",
				incidentNumber: 1,
				isNewIncident: false,
				reason: "Matched by alert fingerprint",
			});
		});

		it("opens a new incident for a different fingerprint even with an open incident already present", async () => {
			const other = alertRow({ id: "alert-2", fingerprint: "fp-other" });

			// No open incident carries this fingerprint.
			mockPrismaService.alert.findFirst.mockResolvedValue(null);
			mockIncidentsService.create.mockResolvedValue({
				id: "incident-2",
				number: 2,
			});

			const result = await service.correlateAlert(other);

			expect(mockIncidentsService.create).toHaveBeenCalledTimes(1);
			expect(result.isNewIncident).toBe(true);
			expect(result.incidentId).toBe("incident-2");
		});

		it("does not match a fingerprint whose only incident is resolved or closed", async () => {
			const alert = alertRow({ id: "alert-3", fingerprint: "fp-stale" });

			// The Prisma query itself excludes resolved/closed incidents, so a
			// fingerprint whose only owner is closed comes back as no match.
			mockPrismaService.alert.findFirst.mockResolvedValue(null);
			mockIncidentsService.create.mockResolvedValue({
				id: "incident-3",
				number: 3,
			});

			await service.correlateAlert(alert);

			expect(mockPrismaService.alert.findFirst).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						incident: { status: { notIn: ["resolved", "closed"] } },
					}),
				}),
			);
			expect(mockIncidentsService.create).toHaveBeenCalledTimes(1);
		});
	});

	describe("resolveIncidentIfNoFiringAlerts", () => {
		it("resolves the incident when no alert on it is still firing", async () => {
			mockPrismaService.alert.count.mockResolvedValue(0);

			await service.resolveIncidentIfNoFiringAlerts("incident-1");

			expect(mockIncidentsService.resolve).toHaveBeenCalledWith("incident-1");
		});

		it("leaves the incident alone while another alert on it is still firing", async () => {
			mockPrismaService.alert.count.mockResolvedValue(1);

			await service.resolveIncidentIfNoFiringAlerts("incident-1");

			expect(mockIncidentsService.resolve).not.toHaveBeenCalled();
		});
	});
});
