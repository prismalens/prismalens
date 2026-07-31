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

	// The interactive-transaction client handed to `$transaction(async (tx) => …)`.
	const mockTx = {
		alert: {
			findUnique: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		incident: {
			update: vi.fn(),
			findFirst: vi.fn(),
		},
		timelineEntry: {
			create: vi.fn(),
		},
	};

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

		mockPrisma.$transaction.mockImplementation(
			async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
		);

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
			// 1. Initial state: the alert is not yet linked, so the claim applies.
			mockTx.alert.findUnique.mockResolvedValue({
				title: "High Memory Alert",
			});
			mockTx.alert.updateMany.mockResolvedValueOnce({ count: 1 });

			const result1 = await service.addAlert("inc-100", "alert-1");

			expect(result1).toBe(true);
			expect(mockTx.alert.updateMany).toHaveBeenLastCalledWith({
				where: {
					id: "alert-1",
					OR: [{ incidentId: null }, { incidentId: { not: "inc-100" } }],
				},
				data: { incidentId: "inc-100", status: "correlated" },
			});
			expect(mockTx.incident.update).toHaveBeenCalledWith({
				where: { id: "inc-100" },
				data: { alertCount: { increment: 1 } },
			});
			expect(mockTx.timelineEntry.create).toHaveBeenCalledTimes(1);
			expect(mockTx.timelineEntry.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					incidentId: "inc-100",
					type: TimelineEntryType.alert_added,
					title: "Alert added",
					description:
						'Alert "High Memory Alert" was correlated to this incident',
					source: TimelineSource.system,
					metadata: JSON.stringify({ alertId: "alert-1" }),
				}),
			});

			// 2. Second call: the alert is ALREADY linked to inc-100, so the
			// conditional claim matches no rows and nothing is counted twice.
			mockTx.alert.updateMany.mockResolvedValueOnce({ count: 0 });

			const result2 = await service.addAlert("inc-100", "alert-1");

			expect(result2).toBe(true);
			expect(mockTx.incident.update).toHaveBeenCalledTimes(1);
			expect(mockTx.timelineEntry.create).toHaveBeenCalledTimes(1);
		});

		it("should not double-increment when a concurrent call already claimed the alert", async () => {
			// Both callers observe an unlinked alert; only one claim can match.
			mockTx.alert.findUnique.mockResolvedValue({ title: "Flapping Alert" });
			mockTx.alert.updateMany
				.mockResolvedValueOnce({ count: 1 })
				.mockResolvedValueOnce({ count: 0 });

			const [first, second] = await Promise.all([
				service.addAlert("inc-200", "alert-2"),
				service.addAlert("inc-200", "alert-2"),
			]);

			expect(first).toBe(true);
			expect(second).toBe(true);
			// The counter and the audit entry are written exactly once.
			expect(mockTx.incident.update).toHaveBeenCalledTimes(1);
			expect(mockTx.timelineEntry.create).toHaveBeenCalledTimes(1);
		});

		it("should return false and write nothing when the alert does not exist", async () => {
			mockTx.alert.findUnique.mockResolvedValue(null);

			const result = await service.addAlert("inc-300", "missing-alert");

			expect(result).toBe(false);
			expect(mockTx.alert.updateMany).not.toHaveBeenCalled();
			expect(mockTx.incident.update).not.toHaveBeenCalled();
			expect(mockTx.timelineEntry.create).not.toHaveBeenCalled();
		});
	});
});
