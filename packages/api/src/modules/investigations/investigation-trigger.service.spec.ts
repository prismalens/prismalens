// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Alert, Incident, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { SettingsService } from "../../core/settings/settings.service.js";
import { QueueService } from "../../infrastructure/queue/queue.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { ALERT_CORRELATED_EVENT } from "../../shared/events/investigation-events.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import {
	InvestigationTriggerService,
	type TriggerConfig,
	type TriggerDecision,
} from "./investigation-trigger.service.js";

describe("InvestigationTriggerService", () => {
	let service: InvestigationTriggerService;
	let prisma: PrismaService;
	let settingsService: SettingsService;
	let queueService: QueueService;
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
			count: vi.fn(),
		},
		incident: {
			findUnique: vi.fn(),
		},
	};

	const mockSettingsService = {
		getInvestigationPolicies: vi.fn(),
	};

	const mockQueueService = {
		addInvestigationJob: vi.fn(),
	};

	const mockIntegrationsService = {
		getIntegrationsForService: vi.fn(),
	};

	const mockTimelineService = {
		create: vi.fn(),
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
				{ provide: SettingsService, useValue: mockSettingsService },
				{ provide: QueueService, useValue: mockQueueService },
				{ provide: IntegrationsService, useValue: mockIntegrationsService },
				{ provide: TimelineService, useValue: mockTimelineService },
			],
		}).compile();

		service = moduleRef.get(InvestigationTriggerService);
		prisma = moduleRef.get(PrismaService);
		settingsService = moduleRef.get(SettingsService);
		queueService = moduleRef.get(QueueService);
		integrationsService = moduleRef.get(IntegrationsService);
		timelineService = moduleRef.get(TimelineService);
	});

	describe("getTriggerConfig", () => {
		it("should return merged policy from settings service", async () => {
			mockSettingsService.getInvestigationPolicies.mockResolvedValue({
				policies: [
					{
						tier: "tier_1",
						autoInvestigate: "always",
						triggerOnAlertCount: 10,
						triggerOnSeverities: ["critical"],
						triggerDelayMinutes: 5,
						reInvestigateOnNewAlerts: false,
						reInvestigateThreshold: 5,
					},
				],
			});

			const config = await service.getTriggerConfig("tier_1");
			expect(config.tier).toBe("tier_1");
			expect(config.autoInvestigate).toBe("always");
			expect(config.triggerOnAlertCount).toBe(10);
		});

		it("should return default if tier not found", async () => {
			mockSettingsService.getInvestigationPolicies.mockResolvedValue({
				policies: [],
			});

			const config = await service.getTriggerConfig("tier_unknown");
			expect(config.tier).toBe("tier_3");
		});
	});

	describe("shouldTriggerInvestigation", () => {
		const baseIncident = {
			id: "inc-1",
			number: 1,
			alertCount: 1,
		} as unknown as Incident & { service?: Service | null };

		it("should return false if autoInvestigate is never", async () => {
			vi.spyOn(service, "getTriggerConfig").mockResolvedValue({
				autoInvestigate: "never",
			} as unknown as TriggerConfig);
			const decision = await service.shouldTriggerInvestigation(baseIncident);
			expect(decision.shouldTrigger).toBe(false);
		});

		it("should return false if investigation already pending/running", async () => {
			vi.spyOn(service, "getTriggerConfig").mockResolvedValue({
				autoInvestigate: "always",
				triggerDelayMinutes: 0,
			} as unknown as TriggerConfig);
			mockPrisma.investigation.findFirst.mockResolvedValue({ id: "inv-1" });
			const decision = await service.shouldTriggerInvestigation(baseIncident);
			expect(decision.shouldTrigger).toBe(false);
			expect(decision.reason).toContain("already in progress");
		});

		it("should return true for always (auto_tier)", async () => {
			vi.spyOn(service, "getTriggerConfig").mockResolvedValue({
				autoInvestigate: "always",
				triggerDelayMinutes: 0,
			} as unknown as TriggerConfig);
			mockPrisma.investigation.findFirst.mockResolvedValue(null);
			const decision = await service.shouldTriggerInvestigation(baseIncident);
			expect(decision.shouldTrigger).toBe(true);
			expect(decision.triggerType).toBe("auto_tier");
		});

		it("should return true for critical_high with matching severity", async () => {
			vi.spyOn(service, "getTriggerConfig").mockResolvedValue({
				autoInvestigate: "critical_high",
				triggerOnSeverities: ["critical"],
				triggerDelayMinutes: 0,
			} as unknown as TriggerConfig);
			mockPrisma.investigation.findFirst.mockResolvedValue(null);
			const incident = {
				...baseIncident,
				severity: "critical",
			} as unknown as Incident & { service?: Service | null };
			const decision = await service.shouldTriggerInvestigation(incident);
			expect(decision.shouldTrigger).toBe(true);
			expect(decision.triggerType).toBe("auto_critical");
		});

		it("should return false for critical_high with non-matching severity", async () => {
			vi.spyOn(service, "getTriggerConfig").mockResolvedValue({
				autoInvestigate: "critical_high",
				triggerOnSeverities: ["critical"],
				triggerOnAlertCount: 999,
				triggerDelayMinutes: 0,
			} as unknown as TriggerConfig);
			mockPrisma.investigation.findFirst.mockResolvedValue(null);
			const incident = {
				...baseIncident,
				severity: "high",
			} as unknown as Incident & { service?: Service | null };
			const decision = await service.shouldTriggerInvestigation(incident);
			expect(decision.shouldTrigger).toBe(false);
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

		it("should enqueue job successfully", async () => {
			mockPrisma.investigation.create.mockResolvedValue({ id: "inv-1" });
			mockIntegrationsService.getIntegrationsForService.mockResolvedValue([
				{ connectionId: "c1" },
			]);
			mockQueueService.addInvestigationJob.mockResolvedValue("job-1");

			await service.triggerInvestigation(incident, decision);

			expect(mockPrisma.investigation.create).toHaveBeenCalled();
			expect(mockQueueService.addInvestigationJob).toHaveBeenCalledWith(
				expect.objectContaining({
					incidentId: "inc-1",
					investigationId: "inv-1",
					priority: "critical",
					connectionIds: ["c1"],
				}),
			);
			expect(mockPrisma.investigation.update).not.toHaveBeenCalled();
			expect(mockTimelineService.create).not.toHaveBeenCalled();
		});

		it("should handle enqueue failure", async () => {
			mockPrisma.investigation.create.mockResolvedValue({ id: "inv-1" });
			mockIntegrationsService.getIntegrationsForService.mockResolvedValue([]);
			mockQueueService.addInvestigationJob.mockResolvedValue(null);

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
			mockPrisma.investigation.create.mockResolvedValue({ id: "inv-1" });
			mockIntegrationsService.getIntegrationsForService.mockRejectedValue(
				new Error("boom"),
			);

			await service.triggerInvestigation(incident, decision);

			expect(mockQueueService.addInvestigationJob).not.toHaveBeenCalled();
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
			expect(mockPrisma.investigation.create).not.toHaveBeenCalled();
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
