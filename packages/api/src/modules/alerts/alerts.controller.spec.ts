// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Test, type TestingModule } from "@nestjs/testing";
import { ORPCError } from "@orpc/nest";
import { CorrelationService } from "../correlation/correlation.service.js";
import { AlertsController } from "./alerts.controller.js";
import { AlertsService } from "./alerts.service.js";

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

const mockCorrelationService = {
	correlateAlert: vi.fn(),
	findSuppressingRule: vi.fn(),
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
				{ provide: CorrelationService, useValue: mockCorrelationService },
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

	describe("correlate — the un-suppression path (#312, ADR-0028 §4)", () => {
		it("should refuse with CONFLICT and name the rule when a suppress rule still blocks the alert", async () => {
			const alert = alertRow();
			mockAlertsService.findById.mockResolvedValue(alert);
			mockCorrelationService.correlateAlert.mockResolvedValue({
				matched: false,
				suppressed: true,
				reason: "Suppressed by rule: Info Suppress Rule",
				ruleId: "rule-1",
				ruleName: "Info Suppress Rule",
				isNewIncident: false,
			});

			const handlers = getHandlers();

			await expect(
				handlers.correlate({ input: { id: alert.id } } as any),
			).rejects.toThrow(ORPCError);

			const error = await handlers
				.correlate({ input: { id: alert.id } } as any)
				.catch((e: ORPCError<string, unknown>) => e);

			expect(error).toBeInstanceOf(ORPCError);
			expect(error.code).toBe("CONFLICT");
			expect(error.message).toContain("Info Suppress Rule");
			// The message must tell the operator what actually unblocks this.
			expect(error.message).toContain("PATCH /correlation/rules/rule-1");
			expect(error.data).toEqual({
				alertId: alert.id,
				ruleId: "rule-1",
				ruleName: "Info Suppress Rule",
			});
		});

		it("should still refuse when a suppressed result carries no rule attribution", async () => {
			// Guards the invariant rather than the happy path: falling through to the
			// 200-with-no-incident response would restore the dead end.
			const alert = alertRow();
			mockAlertsService.findById.mockResolvedValue(alert);
			mockCorrelationService.correlateAlert.mockResolvedValue({
				matched: false,
				suppressed: true,
				isNewIncident: false,
			});

			const handlers = getHandlers();
			const error = await handlers
				.correlate({ input: { id: alert.id } } as any)
				.catch((e: ORPCError<string, unknown>) => e);

			expect(error).toBeInstanceOf(ORPCError);
			expect(error.code).toBe("CONFLICT");
		});

		it("should correlate normally once no rule suppresses the alert any more", async () => {
			const alert = alertRow();
			const correlated = alertRow({
				status: "correlated",
				incidentId: "00000000-0000-0000-0000-0000000000b1",
			});
			mockAlertsService.findById
				.mockResolvedValueOnce(alert)
				.mockResolvedValueOnce(correlated);
			mockCorrelationService.correlateAlert.mockResolvedValue({
				matched: true,
				incidentId: "00000000-0000-0000-0000-0000000000b1",
				incidentNumber: 7,
				reason: "Created new incident",
				isNewIncident: true,
			});

			const handlers = getHandlers();
			const result = await handlers.correlate({
				input: { id: alert.id },
			} as any);

			expect(result.incidentId).toBe("00000000-0000-0000-0000-0000000000b1");
			expect(result.incidentNumber).toBe(7);
			expect(result.isNewIncident).toBe(true);
		});
	});

	describe("get — surfacing 'suppressed by rule X'", () => {
		it("should name the rule holding a suppressed alert down", async () => {
			const alert = alertRow();
			mockAlertsService.findById.mockResolvedValue(alert);
			mockCorrelationService.findSuppressingRule.mockResolvedValue({
				id: "rule-1",
				name: "Info Suppress Rule",
			});

			const handlers = getHandlers();
			const result = await handlers.get({ input: { id: alert.id } } as any);

			expect(result.suppressedBy).toEqual({
				ruleId: "rule-1",
				ruleName: "Info Suppress Rule",
			});
		});

		it("should report no blocker once the suppressing rule is disabled", async () => {
			const alert = alertRow();
			mockAlertsService.findById.mockResolvedValue(alert);
			// Derived from the live rule set — the disabled rule no longer matches.
			mockCorrelationService.findSuppressingRule.mockResolvedValue(null);

			const handlers = getHandlers();
			const result = await handlers.get({ input: { id: alert.id } } as any);

			expect(result.suppressedBy).toBeNull();
		});

		it("should not consult the rule set for an alert that is not suppressed", async () => {
			const alert = alertRow({ status: "triggered" });
			mockAlertsService.findById.mockResolvedValue(alert);

			const handlers = getHandlers();
			const result = await handlers.get({ input: { id: alert.id } } as any);

			expect(result.suppressedBy).toBeNull();
			expect(mockCorrelationService.findSuppressingRule).not.toHaveBeenCalled();
		});
	});
});
