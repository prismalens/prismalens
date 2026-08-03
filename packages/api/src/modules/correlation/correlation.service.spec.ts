// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import type { Alert } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { ALERT_CORRELATED_EVENT } from "../../shared/events/investigation-events.js";
import { IncidentsService } from "../incidents/incidents.service.js";
import {
	type CorrelationResult,
	CorrelationService,
} from "./correlation.service.js";

describe("CorrelationService", () => {
	let service: CorrelationService;

	const mockPrisma = {
		correlationRule: {
			findMany: vi.fn(),
		},
		incident: {
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		alert: {
			findFirst: vi.fn(),
		},
	};

	const mockIncidentsService = {
		create: vi.fn(),
		addAlert: vi.fn(),
	};

	const mockEventEmitter = {
		emit: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({
			providers: [
				CorrelationService,
				{ provide: PrismaService, useValue: mockPrisma },
				{ provide: IncidentsService, useValue: mockIncidentsService },
				{ provide: EventEmitter2, useValue: mockEventEmitter },
			],
		}).compile();

		service = moduleRef.get(CorrelationService);
	});

	describe("correlateAlert", () => {
		it("should emit ALERT_CORRELATED_EVENT when alert matches and links to incident", async () => {
			// Simulate a matched result from the private runCorrelation method by mocking its dependencies
			// The easiest way is to spy on the private method
			const spyTarget = service as unknown as {
				runCorrelation: (alert: Alert) => Promise<CorrelationResult>;
			};
			vi.spyOn(spyTarget, "runCorrelation").mockResolvedValue({
				matched: true,
				incidentId: "inc-1",
				isNewIncident: false,
			});

			const alert = { id: "alert-1" } as Alert;

			await service.correlateAlert(alert);

			expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
			expect(mockEventEmitter.emit).toHaveBeenCalledWith(
				ALERT_CORRELATED_EVENT,
				{
					alertId: "alert-1",
					incidentId: "inc-1",
					isNewIncident: false,
				},
			);
		});

		it("should not emit when correlation returns suppressed/unmatched result", async () => {
			const spyTarget = service as unknown as {
				runCorrelation: (alert: Alert) => Promise<CorrelationResult>;
			};
			vi.spyOn(spyTarget, "runCorrelation").mockResolvedValue({
				matched: false,
				isNewIncident: false,
			});

			const alert = { id: "alert-1" } as Alert;

			await service.correlateAlert(alert);

			expect(mockEventEmitter.emit).not.toHaveBeenCalled();
		});

		it("should short-circuit runCorrelation if alert is already linked to an incident", async () => {
			const alert = { id: "alert-1", incidentId: "inc-1" } as Alert;
			mockPrisma.incident.findUnique.mockResolvedValueOnce({
				id: "inc-1",
				number: 42,
			});

			const result = await service.correlateAlert(alert);

			expect(result).toEqual({
				matched: true,
				incidentId: "inc-1",
				incidentNumber: 42,
				reason: "Already correlated to incident",
				isNewIncident: false,
				alreadyCorrelated: true,
			});
			expect(mockPrisma.incident.findUnique).toHaveBeenCalledWith({
				where: { id: "inc-1" },
			});
			expect(mockIncidentsService.create).not.toHaveBeenCalled();
			expect(mockIncidentsService.addAlert).not.toHaveBeenCalled();
		});

		it("should not re-emit ALERT_CORRELATED_EVENT when the alert was already correlated", async () => {
			const alert = { id: "alert-1", incidentId: "inc-1" } as Alert;
			mockPrisma.incident.findUnique.mockResolvedValueOnce({
				id: "inc-1",
				number: 42,
			});

			const result = await service.correlateAlert(alert);

			expect(result.alreadyCorrelated).toBe(true);
			expect(mockEventEmitter.emit).not.toHaveBeenCalled();
		});
	});

	describe("testCorrelation", () => {
		it("should return non-null matchedRule when a rule matches", async () => {
			const rule = {
				id: "rule-10",
				name: "Database High Severity Rule",
				action: "correlate",
				timeWindowMinutes: 30,
				matchCriteria: JSON.stringify({
					match: { severity: ["high"] },
				}),
			};

			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);
			mockPrisma.incident.findFirst.mockResolvedValueOnce({
				id: "inc-99",
				number: 99,
			});

			const result = await service.testCorrelation({
				title: "DB Error",
				severity: "high",
			});

			expect(result.matchedRule).toEqual(rule);
			expect(result.action).toBe("correlate");
			expect(result.reason).toContain("Matched by rule: Database High Severity Rule");
			expect(mockIncidentsService.create).not.toHaveBeenCalled();
			expect(mockIncidentsService.addAlert).not.toHaveBeenCalled();
		});

		it("should fall through to fingerprint correlation when a rule matches but no incident is in its window", async () => {
			// matchToIncidentByRules keeps going in this situation, so the test
			// endpoint must not stop at "would create new incident".
			const rule = {
				id: "rule-11",
				name: "Database High Severity Rule",
				action: "correlate",
				timeWindowMinutes: 30,
				matchCriteria: JSON.stringify({ match: { severity: ["high"] } }),
			};

			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);
			// No incident inside the rule's window.
			mockPrisma.incident.findFirst.mockResolvedValueOnce(null);
			// …but an alert with the same fingerprint is already on an incident.
			mockPrisma.alert.findFirst.mockResolvedValueOnce({
				id: "alert-77",
				incident: { id: "inc-77", number: 77 },
			});

			const result = await service.testCorrelation({
				title: "DB Error",
				severity: "high",
			});

			expect(result.action).toBe("correlate");
			expect(result.reason).toContain("fingerprint");
			expect(result.matchedRule).toBeNull();
			expect(mockIncidentsService.create).not.toHaveBeenCalled();
			expect(mockIncidentsService.addAlert).not.toHaveBeenCalled();
		});

		it("should report create_incident only when rule, fingerprint and time window all miss", async () => {
			const rule = {
				id: "rule-12",
				name: "Database High Severity Rule",
				action: "correlate",
				timeWindowMinutes: 30,
				matchCriteria: JSON.stringify({ match: { severity: ["high"] } }),
			};

			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);
			// Once for the rule's window, once for the time-window fallback.
			mockPrisma.incident.findFirst
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null);
			mockPrisma.alert.findFirst.mockResolvedValueOnce(null);

			const result = await service.testCorrelation({
				title: "DB Error",
				severity: "high",
			});

			expect(result.action).toBe("create_incident");
			expect(result.matchedRule).toBeNull();
		});

		it("should fall through past a matching suppress rule instead of predicting 'suppress'", async () => {
			// matchToIncidentByRules returns matched: false as soon as it hits a
			// suppress rule — it never actually suppresses the alert. The preview
			// must mirror that and fall through to fingerprint/time-window/
			// create_incident rather than report an outcome the engine never
			// produces.
			const rule = {
				id: "rule-13",
				name: "Noisy Service Suppress Rule",
				action: "suppress",
				timeWindowMinutes: 30,
				matchCriteria: JSON.stringify({ match: { severity: ["high"] } }),
			};

			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);
			mockPrisma.incident.findFirst
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null);
			mockPrisma.alert.findFirst.mockResolvedValueOnce(null);

			const result = await service.testCorrelation({
				title: "DB Error",
				severity: "high",
			});

			expect(result.action).toBe("create_incident");
			expect(result.matchedRule).toBeNull();
		});
	});
});
