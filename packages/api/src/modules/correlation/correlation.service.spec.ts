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
			findUnique: vi.fn(),
			update: vi.fn(),
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
		vi.resetAllMocks();
		vi.restoreAllMocks();
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

		it("should handle rule-based suppression and terminate the waterfall", async () => {
			const rule = {
				id: "rule-1",
				name: "Info Suppress Rule",
				action: "suppress",
				priority: 10,
				timeWindowMinutes: 60,
				matchCriteria: JSON.stringify({ match: { severity: ["info"] } }),
			};
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);

			const alert = {
				id: "alert-1",
				severity: "info",
				incidentId: null,
				status: "triggered",
			} as Alert;

			const result = await service.correlateAlert(alert);

			expect(mockIncidentsService.create).not.toHaveBeenCalled();
			expect(mockIncidentsService.addAlert).not.toHaveBeenCalled();
			expect(mockPrisma.alert.update).toHaveBeenCalledTimes(1);
			expect(mockPrisma.alert.update).toHaveBeenCalledWith({
				where: { id: "alert-1" },
				data: { status: "suppressed" },
			});
			expect(result).toEqual({
				matched: false,
				suppressed: true,
				reason: "Suppressed by rule: Info Suppress Rule",
				ruleId: "rule-1",
				ruleName: "Info Suppress Rule",
				isNewIncident: false,
			});
		});

		it("should ensure suppression beats tier-3 time-window fallback", async () => {
			const rule = {
				id: "rule-1",
				name: "Info Suppress Rule",
				action: "suppress",
				priority: 10,
				timeWindowMinutes: 60,
				matchCriteria: JSON.stringify({ match: { severity: ["info"] } }),
			};
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);
			mockPrisma.incident.findFirst.mockResolvedValueOnce({
				id: "inc-99",
				number: 99,
			});

			const alert = {
				id: "alert-1",
				severity: "info",
				serviceId: "svc-1",
				incidentId: null,
				status: "triggered",
			} as Alert;

			const result = await service.correlateAlert(alert);

			expect(mockIncidentsService.addAlert).not.toHaveBeenCalled();
			expect(mockPrisma.incident.update).not.toHaveBeenCalled();
			expect(result.suppressed).toBe(true);
			expect(result.matched).toBe(false);
		});

		it("should evaluate the re-read row, not the caller's stale copy, in the suppress guard", async () => {
			// #312: runCorrelation re-reads the alert but used to hand the caller's
			// copy to matchToIncidentByRules. A caller holding a stale "triggered"
			// snapshot of an already-suppressed row therefore drove a redundant
			// write, breaking ADR-0028 §2's zero-write no-op.
			const rule = {
				id: "rule-1",
				name: "Info Suppress Rule",
				action: "suppress",
				priority: 10,
				timeWindowMinutes: 60,
				matchCriteria: JSON.stringify({ match: { severity: ["info"] } }),
			};
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);

			const staleAlert = {
				id: "alert-1",
				severity: "info",
				incidentId: null,
				status: "triggered",
			} as Alert;
			// The row itself is already suppressed.
			mockPrisma.alert.findUnique.mockResolvedValueOnce({
				...staleAlert,
				status: "suppressed",
			});

			const result = await service.correlateAlert(staleAlert);

			expect(mockPrisma.alert.findUnique).toHaveBeenCalledWith({
				where: { id: "alert-1" },
			});
			expect(mockPrisma.alert.update).not.toHaveBeenCalled();
			expect(result.suppressed).toBe(true);
		});

		it("should make re-suppression a zero-write no-op", async () => {
			const rule = {
				id: "rule-1",
				name: "Info Suppress Rule",
				action: "suppress",
				priority: 10,
				timeWindowMinutes: 60,
				matchCriteria: JSON.stringify({ match: { severity: ["info"] } }),
			};
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);

			const alert = {
				id: "alert-1",
				severity: "info",
				incidentId: null,
				status: "suppressed",
			} as Alert;

			const result = await service.correlateAlert(alert);

			expect(mockPrisma.alert.update).not.toHaveBeenCalled();
			expect(mockEventEmitter.emit).not.toHaveBeenCalled();
			expect(result).toEqual({
				matched: false,
				suppressed: true,
				reason: "Suppressed by rule: Info Suppress Rule",
				ruleId: "rule-1",
				ruleName: "Info Suppress Rule",
				isNewIncident: false,
			});
		});
	});

	describe("findSuppressingRule", () => {
		const suppressRule = {
			id: "rule-1",
			name: "Info Suppress Rule",
			action: "suppress",
			priority: 10,
			timeWindowMinutes: 60,
			matchCriteria: JSON.stringify({ match: { severity: ["info"] } }),
		};

		const suppressedAlert = {
			id: "alert-1",
			title: "Disk usage nominal",
			severity: "info",
			incidentId: null,
			status: "suppressed",
		} as Alert;

		it("should name the enabled rule that currently blocks the alert", async () => {
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([suppressRule]);

			const rule = await service.findSuppressingRule(suppressedAlert);

			expect(rule).toEqual(suppressRule);
		});

		it("should return null once the suppressing rule is disabled", async () => {
			// findAllRules({ enabled: true }) no longer returns the rule.
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([]);
			mockPrisma.alert.findFirst.mockResolvedValueOnce(null);
			mockPrisma.incident.findFirst.mockResolvedValueOnce(null);

			const rule = await service.findSuppressingRule(suppressedAlert);

			expect(rule).toBeNull();
		});

		it("should return null when a higher-precedence correlate rule wins first", async () => {
			const correlateRule = {
				id: "rule-0",
				name: "Info Correlate Rule",
				action: "correlate",
				priority: 5,
				timeWindowMinutes: 60,
				matchCriteria: JSON.stringify({ match: { severity: ["info"] } }),
			};
			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([
				correlateRule,
				suppressRule,
			]);
			mockPrisma.incident.findFirst.mockResolvedValueOnce({
				id: "inc-1",
				number: 1,
			});

			const rule = await service.findSuppressingRule(suppressedAlert);

			expect(rule).toBeNull();
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

		it("should predict suppress action and stop without querying fingerprint or time-window fallback", async () => {
			const rule = {
				id: "rule-13",
				name: "Noisy Service Suppress Rule",
				action: "suppress",
				priority: 10,
				timeWindowMinutes: 30,
				matchCriteria: JSON.stringify({ match: { severity: ["high"] } }),
			};

			mockPrisma.correlationRule.findMany.mockResolvedValueOnce([rule]);

			const result = await service.testCorrelation({
				title: "DB Error",
				severity: "high",
			});

			expect(result).toEqual({
				matchedRule: rule,
				action: "suppress",
				reason: "Suppressed by rule: Noisy Service Suppress Rule",
			});
			expect(mockPrisma.incident.findFirst).not.toHaveBeenCalled();
			expect(mockPrisma.alert.findFirst).not.toHaveBeenCalled();
		});
	});
});
