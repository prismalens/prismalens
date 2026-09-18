// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Alert, Incident, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { ALERT_CORRELATED_EVENT } from "../../shared/events/investigation-events.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { InvestigationsService } from "./investigations.service.js";
import {
	InvestigationTriggerService,
	NO_SERVICE_REASON,
	readTriggerPolicy,
	type TriggerDecision,
} from "./investigation-trigger.service.js";

describe("InvestigationTriggerService", () => {
	let service: InvestigationTriggerService;
	let prisma: PrismaService;
	let dispatchService: DispatchService;
	let integrationsService: IntegrationsService;
	let timelineService: TimelineService;

	const mockPrisma = {
		investigation: {
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		alert: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			count: vi.fn(),
		},
		incident: {
			findUnique: vi.fn(),
		},
	};

	const mockDispatchService = {
		addInvestigationJob: vi.fn(),
	};

	const mockIntegrationsService = {
		getIntegrationsForService: vi.fn(),
	};

	const mockTimelineService = {
		create: vi.fn(),
	};

	const mockInvestigationsService = {
		startOrGet: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({
			providers: [
				InvestigationTriggerService,
				{ provide: PrismaService, useValue: mockPrisma },
				{ provide: DispatchService, useValue: mockDispatchService },
				{ provide: IntegrationsService, useValue: mockIntegrationsService },
				{ provide: TimelineService, useValue: mockTimelineService },
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
			],
		}).compile();

		service = moduleRef.get(InvestigationTriggerService);
		prisma = moduleRef.get(PrismaService);
		dispatchService = moduleRef.get(DispatchService);
		integrationsService = moduleRef.get(IntegrationsService);
		timelineService = moduleRef.get(TimelineService);
	});

	describe("readTriggerPolicy", () => {
		it("defaults when the service has no metadata", () => {
			expect(readTriggerPolicy(null)).toBe("critical_and_high");
		});

		it("reads the service's own policy", () => {
			expect(
				readTriggerPolicy(JSON.stringify({ investigation: { trigger: "never" } })),
			).toBe("never");
		});

		it("defaults on an unknown value or unparseable metadata", () => {
			expect(
				readTriggerPolicy(JSON.stringify({ investigation: { trigger: "sometimes" } })),
			).toBe("critical_and_high");
			expect(readTriggerPolicy("{not json")).toBe("critical_and_high");
		});
	});

	describe("shouldTriggerInvestigation", () => {
		const withPolicy = (
			trigger: string | undefined,
			severity: string,
			alertCount = 1,
		) =>
			({
				id: "inc-1",
				number: 1,
				alertCount,
				severity,
				service: {
					id: "srv-1",
					name: "svc",
					metadata: trigger
						? JSON.stringify({ investigation: { trigger } })
						: null,
				},
			}) as unknown as Incident & { service?: Service | null };

		beforeEach(() => {
			mockPrisma.investigation.findFirst.mockResolvedValue(null);
		});

		it("never triggers without a service, and says why", async () => {
			const decision = await service.shouldTriggerInvestigation({
				id: "inc-1",
				number: 1,
				alertCount: 1,
				severity: "critical",
				service: null,
			} as unknown as Incident & { service?: Service | null });
			expect(decision.shouldTrigger).toBe(false);
			expect(decision.reason).toBe(NO_SERVICE_REASON);
		});

		it("triggers a high alert on a service with no policy set (the default)", async () => {
			const decision = await service.shouldTriggerInvestigation(
				withPolicy(undefined, "high"),
			);
			expect(decision.shouldTrigger).toBe(true);
			expect(decision.triggerType).toBe("auto_critical");
		});

		it("does not trigger a medium alert under the default", async () => {
			const decision = await service.shouldTriggerInvestigation(
				withPolicy(undefined, "medium"),
			);
			expect(decision.shouldTrigger).toBe(false);
		});

		it("critical_only ignores high", async () => {
			const decision = await service.shouldTriggerInvestigation(
				withPolicy("critical_only", "high"),
			);
			expect(decision.shouldTrigger).toBe(false);
		});

		it("always triggers on any severity", async () => {
			const decision = await service.shouldTriggerInvestigation(
				withPolicy("always", "low"),
			);
			expect(decision.shouldTrigger).toBe(true);
			expect(decision.triggerType).toBe("auto_tier");
		});

		it("never is off even for critical", async () => {
			const decision = await service.shouldTriggerInvestigation(
				withPolicy("never", "critical"),
			);
			expect(decision.shouldTrigger).toBe(false);
			expect(mockPrisma.investigation.findFirst).not.toHaveBeenCalled();
		});

		it("does not start a second run while one is pending or running", async () => {
			mockPrisma.investigation.findFirst.mockResolvedValue({ id: "inv-1" });
			const decision = await service.shouldTriggerInvestigation(
				withPolicy(undefined, "critical"),
			);
			expect(decision.shouldTrigger).toBe(false);
			expect(decision.reason).toContain("already in progress");
		});
	});

	describe("onAlertCorrelated", () => {
		it("writes one timeline hint on the first alert of a service-less incident", async () => {
			const incident = {
				id: "inc-1",
				number: 1,
				alertCount: 1,
				severity: "critical",
				service: null,
			} as unknown as Incident & { service?: Service | null };
			await service.onAlertCorrelated({ id: "a1" } as unknown as Alert, incident);
			expect(mockTimelineService.create).toHaveBeenCalledTimes(1);
			expect(mockTimelineService.create.mock.calls[0][0].description).toBe(
				NO_SERVICE_REASON,
			);
			expect(mockInvestigationsService.startOrGet).not.toHaveBeenCalled();

			mockTimelineService.create.mockClear();
			await service.onAlertCorrelated({ id: "a2" } as unknown as Alert, {
				...incident,
				alertCount: 2,
			});
			expect(mockTimelineService.create).not.toHaveBeenCalled();
		});
	});

	describe("triggerInvestigation", () => {
		const incident = {
			id: "inc-1",
			number: 1,
			severity: "critical",
			title: "Test",
			alertCount: 1,
			serviceId: "srv-1",
			service: { name: "Test Service" },
		} as unknown as Incident & { service?: Service | null };
		const decision = {
			shouldTrigger: true,
			triggerType: "auto_tier",
			reason: "Test reason",
		} as unknown as TriggerDecision;

		it("does not enqueue when an investigation is already in progress", async () => {
			mockInvestigationsService.startOrGet.mockResolvedValue({ investigation: { id: "inv-running" }, created: false });

			await service.triggerInvestigation(incident, decision);

			expect(mockDispatchService.addInvestigationJob).not.toHaveBeenCalled();
		});

		it("should enqueue job successfully", async () => {
			mockInvestigationsService.startOrGet.mockResolvedValue({ investigation: { id: "inv-1" }, created: true });
			mockIntegrationsService.getIntegrationsForService.mockResolvedValue([
				{ connectionId: "c1" },
			]);
			// Auto-trigger path (follow-up 4a, issue #302): the incident's alerts must
			// be fetched and threaded through as `FiringAlert`s, matching the manual
			// trigger path (incidents.controller.ts `investigate`) instead of silently
			// relying on the worker's DB fallback.
			mockPrisma.alert.findMany.mockResolvedValue([
				{
					title: "High CPU",
					severity: "critical",
					labels: JSON.stringify({ service: "checkout" }),
					description: "CPU pegged at 100%",
					triggeredAt: new Date("2026-08-01T00:00:00.000Z"),
				},
			]);
			mockDispatchService.addInvestigationJob.mockResolvedValue("job-1");

			await service.triggerInvestigation(incident, decision);

			expect(mockPrisma.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ where: { incidentId: "inc-1" } }),
			);
			expect(mockInvestigationsService.startOrGet).toHaveBeenCalled();
			expect(mockDispatchService.addInvestigationJob).toHaveBeenCalledWith(
				expect.objectContaining({
					incidentId: "inc-1",
					investigationId: "inv-1",
					priority: "critical",
					connectionIds: ["c1"],
					alerts: [
						expect.objectContaining({
							alertname: "High CPU",
							severity: "critical",
							labels: { service: "checkout" },
							annotations: { summary: "CPU pegged at 100%" },
							startsAt: "2026-08-01T00:00:00.000Z",
						}),
					],
				}),
			);
			expect(mockPrisma.investigation.update).not.toHaveBeenCalled();
			expect(mockTimelineService.create).not.toHaveBeenCalled();
		});

		it("should omit alerts when the incident has none (matches manual-path shape)", async () => {
			mockInvestigationsService.startOrGet.mockResolvedValue({ investigation: { id: "inv-1" }, created: true });
			mockIntegrationsService.getIntegrationsForService.mockResolvedValue([]);
			mockPrisma.alert.findMany.mockResolvedValue([]);
			mockDispatchService.addInvestigationJob.mockResolvedValue("job-1");

			await service.triggerInvestigation(incident, decision);

			expect(mockDispatchService.addInvestigationJob).toHaveBeenCalledWith(
				expect.objectContaining({ alerts: undefined }),
			);
		});

		it("should handle enqueue failure", async () => {
			mockInvestigationsService.startOrGet.mockResolvedValue({ investigation: { id: "inv-1" }, created: true });
			mockIntegrationsService.getIntegrationsForService.mockResolvedValue([]);
			mockPrisma.alert.findMany.mockResolvedValue([]);
			mockDispatchService.addInvestigationJob.mockResolvedValue(null);

			await service.triggerInvestigation(incident, decision);

			expect(mockPrisma.investigation.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "inv-1" },
					data: { status: "failed", error: expect.any(String) },
				}),
			);
			expect(mockTimelineService.create).toHaveBeenCalled();
		});

		it("should mark failed when integration/enqueue throws", async () => {
			mockInvestigationsService.startOrGet.mockResolvedValue({ investigation: { id: "inv-1" }, created: true });
			mockIntegrationsService.getIntegrationsForService.mockRejectedValue(
				new Error("boom"),
			);

			await service.triggerInvestigation(incident, decision);

			expect(mockDispatchService.addInvestigationJob).not.toHaveBeenCalled();
			expect(mockPrisma.investigation.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "inv-1" },
					data: { status: "failed", error: expect.any(String) },
				}),
			);
			expect(mockTimelineService.create).toHaveBeenCalled();
		});
	});

	describe("handleAlertCorrelated", () => {
		it("should warn if alert or incident not found", async () => {
			mockPrisma.alert.findUnique.mockResolvedValue(null);
			mockPrisma.incident.findUnique.mockResolvedValue(null);

			await service.handleAlertCorrelated({
				alertId: "a1",
				incidentId: "i1",
				isNewIncident: false,
			});
			expect(mockInvestigationsService.startOrGet).not.toHaveBeenCalled();
		});

		it("should process alert if found", async () => {
			const alert = { id: "a1" } as unknown as Alert;
			const incident = { id: "i1", number: 1 } as unknown as Incident & {
				service?: Service | null;
			};
			mockPrisma.alert.findUnique.mockResolvedValue(alert);
			mockPrisma.incident.findUnique.mockResolvedValue(incident);

			const onAlertSpy = vi
				.spyOn(service, "onAlertCorrelated")
				.mockResolvedValue();

			await service.handleAlertCorrelated({
				alertId: "a1",
				incidentId: "i1",
				isNewIncident: false,
			});
			expect(onAlertSpy).toHaveBeenCalledWith(alert, incident);
		});
	});
});
