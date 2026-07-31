// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { IncidentsService } from "./incidents.service.js";

describe("IncidentsService", () => {
	let service: IncidentsService;

	const mockPrisma = {
		alert: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		incident: {
			update: vi.fn(),
			findFirst: vi.fn(),
		},
		$transaction: vi.fn(),
	};

	const mockTimelineService = {
		create: vi.fn(),
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({
			providers: [
				IncidentsService,
				{ provide: PrismaService, useValue: mockPrisma },
				{ provide: TimelineService, useValue: mockTimelineService },
			],
		}).compile();

		service = moduleRef.get(IncidentsService);
	});

	describe("addAlert idempotency", () => {
		it("should link alert and increment alertCount only on initial call, and short-circuit on re-correlation", async () => {
			// 1. Initial state: Alert is not linked to any incident
			mockPrisma.alert.findUnique.mockResolvedValueOnce({
				incidentId: null,
				title: "High Memory Alert",
			});
			mockPrisma.$transaction.mockResolvedValueOnce([{}, {}]);
			mockTimelineService.create.mockResolvedValueOnce({});

			const result1 = await service.addAlert("inc-100", "alert-1");

			expect(result1).toBe(true);
			expect(mockPrisma.alert.findUnique).toHaveBeenLastCalledWith({
				where: { id: "alert-1" },
				select: { incidentId: true, title: true },
			});
			expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
			expect(mockTimelineService.create).toHaveBeenCalledTimes(1);
			expect(mockTimelineService.create).toHaveBeenCalledWith({
				incidentId: "inc-100",
				type: TimelineEntryType.alert_added,
				title: "Alert added",
				description: 'Alert "High Memory Alert" was correlated to this incident',
				source: TimelineSource.system,
				metadata: { alertId: "alert-1" },
			});

			// 2. Second call: Alert is ALREADY linked to inc-100
			mockPrisma.alert.findUnique.mockResolvedValueOnce({
				incidentId: "inc-100",
				title: "High Memory Alert",
			});

			const result2 = await service.addAlert("inc-100", "alert-1");

			expect(result2).toBe(true);
			// Transaction and timeline creation must NOT be called again
			expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
			expect(mockTimelineService.create).toHaveBeenCalledTimes(1);
		});
	});
});
