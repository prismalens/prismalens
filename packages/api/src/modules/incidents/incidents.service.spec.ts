// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { IncidentsService } from "./incidents.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { telemetryStub } from "../../../test/factories/index.js";

describe("IncidentsService", () => {
	let service: IncidentsService;

	// The interactive-transaction client handed to `$transaction(async (tx) => …)`.
	const mockTx = {
		alert: {
			findUnique: vi.fn(),
			findMany: vi.fn().mockResolvedValue([]),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		alertSourceAlert: {
			updateMany: vi.fn(),
		},
		incident: {
			create: vi.fn(),
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
			findMany: vi.fn().mockResolvedValue([]),
		},
		investigation: {
			findMany: vi.fn().mockResolvedValue([]),
		},
		investigationEvent: {
			groupBy: vi.fn().mockResolvedValue([]),
			findFirst: vi.fn().mockResolvedValue(null),
		},
		incident: {
			update: vi.fn(),
			findFirst: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			count: vi.fn(),
			groupBy: vi.fn(),
			aggregate: vi.fn(),
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
				{ provide: TelemetryService, useValue: telemetryStub() },
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

		it("should decrement the previous incident's alertCount when re-pointing an alert to a different incident", async () => {
			mockTx.alert.findUnique.mockResolvedValue({
				title: "Flapping Alert",
				incidentId: "inc-old",
			});
			mockTx.alert.updateMany.mockResolvedValueOnce({ count: 1 });

			const result = await service.addAlert("inc-new", "alert-9");

			expect(result).toBe(true);
			expect(mockTx.incident.update).toHaveBeenCalledWith({
				where: { id: "inc-old" },
				data: { alertCount: { decrement: 1 } },
			});
			expect(mockTx.incident.update).toHaveBeenCalledWith({
				where: { id: "inc-new" },
				data: { alertCount: { increment: 1 } },
			});
			expect(mockTx.incident.update).toHaveBeenCalledTimes(2);
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

	describe("resolve with a reason (#605)", () => {
		it("says in the status entry why the system resolved the incident", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "open",
				triggeredAt: new Date(Date.now() - 60_000),
				resolvedAt: null,
			});
			mockTx.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.resolve("inc-1", {
				text: "no connected Alertmanager still lists HighLatency (fp-1); no resolved notification was received",
				reason: "alertmanager-absence",
			});

			expect(mockTimelineService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					description:
						"Status changed from open to resolved: no connected Alertmanager still lists HighLatency (fp-1); no resolved notification was received",
					metadata: {
						previousStatus: "open",
						newStatus: "resolved",
						reason: "alertmanager-absence",
					},
				}),
			);
		});
	});

	describe("close", () => {
		const triggeredAt = new Date(Date.now() - 60_000);

		it("stamps resolvedAt when closing an incident that was never resolved", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "investigating",
				triggeredAt,
				resolvedAt: null,
			});
			mockTx.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.close("inc-1");

			const { data } = mockTx.incident.update.mock.calls[0][0];
			expect(data.status).toBe("closed");
			expect(data.resolvedAt).toBeInstanceOf(Date);
			expect(data.timeToResolve).toBeGreaterThanOrEqual(60);
		});

		it("records the actual cause when the responder gives one (#338)", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "resolved",
				triggeredAt,
				resolvedAt: new Date(),
			});
			mockTx.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.close("inc-1", {
				actualCause: "  DB_POOL_SIZE dropped to 5  ",
				actualCauseCategory: "config",
			});

			// #667 review: one write, not two. Closing and recording the cause
			// used to be separate updates, so a failure between them left the
			// incident closed with the cause dropped while the API reported
			// failure. Asserting the call count is what pins that shut.
			expect(mockTx.incident.update).toHaveBeenCalledTimes(1);
			expect(mockPrisma.incident.update).not.toHaveBeenCalled();
			const only = mockTx.incident.update.mock.calls[0]?.[0];
			expect(only.data).toMatchObject({
				status: "closed",
				actualCause: "DB_POOL_SIZE dropped to 5",
				actualCauseCategory: "config",
			});
		});

		it("writes no cause when none is given", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "resolved",
				triggeredAt,
				resolvedAt: new Date(),
			});
			mockTx.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.close("inc-1", { actualCause: "   " });

			expect(mockTx.incident.update).toHaveBeenCalledTimes(1);
		});

		it("keeps the original resolvedAt when closing a resolved incident", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "resolved",
				triggeredAt,
				resolvedAt: new Date(),
			});
			mockTx.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.close("inc-1");

			const { data } = mockTx.incident.update.mock.calls[0][0];
			expect(data.status).toBe("closed");
			expect(data.resolvedAt).toBeUndefined();
		});
	});

	describe("ending an incident resolves its firing alerts (walk f32)", () => {
		const triggeredAt = new Date(Date.now() - 60_000);

		function open(status: string) {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status,
				triggeredAt,
				resolvedAt: null,
			});
			mockTx.incident.update.mockResolvedValue({ id: "inc-1" });
		}

		it("close resolves the firing alert, its member rows, and says why on the timeline", async () => {
			open("identified");
			mockTx.alert.findMany.mockResolvedValueOnce([{ id: "alert-1" }]);

			await service.close("inc-1", { actualCause: "pool capped" });

			expect(mockTx.alert.findMany).toHaveBeenCalledWith({
				where: {
					incidentId: "inc-1",
					status: { in: ["triggered", "acknowledged", "correlated"] },
				},
				select: { id: true },
			});
			expect(mockTx.alert.updateMany).toHaveBeenCalledWith({
				where: { id: { in: ["alert-1"] } },
				data: expect.objectContaining({
					status: "resolved",
					resolvedAt: expect.any(Date),
				}),
			});
			expect(mockTx.alertSourceAlert.updateMany).toHaveBeenCalledWith({
				where: { alertId: { in: ["alert-1"] }, resolvedAt: null },
				data: { resolvedAt: expect.any(Date) },
			});
			expect(mockTx.timelineEntry.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					incidentId: "inc-1",
					type: TimelineEntryType.status_changed,
					title: "Resolved 1 firing alert with the incident",
					metadata: JSON.stringify({
						reason: "incident-closed",
						alertIds: ["alert-1"],
					}),
				}),
			});
		});

		it("resolve does the same with its own reason", async () => {
			open("investigating");
			mockTx.alert.findMany.mockResolvedValueOnce([
				{ id: "alert-1" },
				{ id: "alert-2" },
			]);

			await service.resolve("inc-1");

			expect(mockTx.alert.updateMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: { in: ["alert-1", "alert-2"] } },
				}),
			);
			expect(mockTx.timelineEntry.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					title: "Resolved 2 firing alerts with the incident",
					metadata: JSON.stringify({
						reason: "incident-resolved",
						alertIds: ["alert-1", "alert-2"],
					}),
				}),
			});
		});

		it("writes nothing about alerts when none is firing", async () => {
			open("resolved");
			mockTx.alert.findMany.mockResolvedValueOnce([]);

			await service.close("inc-1");

			expect(mockTx.alert.updateMany).not.toHaveBeenCalled();
			expect(mockTx.alertSourceAlert.updateMany).not.toHaveBeenCalled();
			expect(mockTx.timelineEntry.create).not.toHaveBeenCalled();
		});
	});

	describe("create after an ended incident (walk f32)", () => {
		it("names the prior incident in the opening entry", async () => {
			mockTx.incident.findFirst.mockResolvedValue({ number: 10 });
			mockTx.incident.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
				id: "inc-11",
				...data,
			}));

			await service.create({
				title: "BooklogrLibraryListSlow",
				priorIncident: {
					id: "inc-10",
					number: 10,
					status: "closed",
					endedAt: new Date("2026-10-01T14:22:00.000Z"),
					alertName: "BooklogrLibraryListSlow",
				},
			});

			expect(mockTimelineService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					incidentId: "inc-11",
					type: TimelineEntryType.incident_created,
					description:
						"New incident: BooklogrLibraryListSlow fired again after INC-10 was closed 2026-10-01T14:22:00.000Z",
					metadata: { priorIncidentId: "inc-10" },
				}),
			);
		});
	});

	describe("reopen (#743)", () => {
		it("reopens a closed incident the same way, keeping its cause (walk u18)", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "closed",
				triggeredAt: new Date("2026-10-01T09:00:00Z"),
				acknowledgedAt: new Date("2026-10-01T09:05:00Z"),
				resolvedAt: new Date("2026-10-01T10:00:00Z"),
				actualCause: "pool capped",
			});
			mockPrisma.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.update("inc-1", { status: "investigating" });

			const { data } = mockPrisma.incident.update.mock.calls[0][0];
			expect(data.resolvedAt).toBeNull();
			expect(data.actualCause).toBeUndefined();
			expect(mockTimelineService.create).toHaveBeenCalledWith(
				expect.objectContaining({
					title: "Incident reopened",
					metadata: expect.objectContaining({ previousStatus: "closed" }),
				}),
			);
		});

		it("clears the resolve time and says the incident was reopened", async () => {
			mockPrisma.incident.findUnique.mockResolvedValue({
				id: "inc-1",
				status: "resolved",
				triggeredAt: new Date("2026-10-01T09:00:00Z"),
				acknowledgedAt: new Date("2026-10-01T09:05:00Z"),
				resolvedAt: new Date("2026-10-01T10:00:00Z"),
			});
			mockPrisma.incident.update.mockResolvedValue({ id: "inc-1" });

			await service.update("inc-1", { status: "investigating" });

			const { data } = mockPrisma.incident.update.mock.calls[0][0];
			expect(data.resolvedAt).toBeNull();
			expect(data.timeToResolve).toBeNull();
			expect(mockTimelineService.create).toHaveBeenCalledWith(
				expect.objectContaining({ title: "Incident reopened" }),
			);
		});
	});

	describe("findAll", () => {
		it("returns paginated data and total count", async () => {
			const incidents = [{ id: "inc-1" }, { id: "inc-2" }];
			mockPrisma.incident.findMany.mockResolvedValue(incidents);
			mockPrisma.incident.count.mockResolvedValue(5);

			const result = await service.findAll({ limit: 2, offset: 0 });

			expect(result.data).toEqual(incidents.map((i) => ({ ...i, services: [] })));
			expect(result.total).toBe(5);
		});

		it("lists every service an incident touches, its own first, once each (#743)", async () => {
			mockPrisma.incident.findMany.mockResolvedValue([
				{ id: "inc-1", service: { id: "svc-a", name: "checkout", displayName: "Checkout" } },
				{ id: "inc-2", service: null },
			]);
			mockPrisma.incident.count.mockResolvedValue(2);
			mockPrisma.alert.findMany.mockResolvedValueOnce([
				{ incidentId: "inc-1", service: { id: "svc-b", name: "payments", displayName: null } },
				{ incidentId: "inc-1", service: { id: "svc-a", name: "checkout", displayName: "Checkout" } },
				{ incidentId: "inc-2", service: { id: "svc-b", name: "payments", displayName: null } },
			]);

			const { data } = await service.findAll({ limit: 50, offset: 0 });

			expect(data.map((i) => i.services)).toEqual([
				[
					{ id: "svc-a", name: "checkout", displayName: "Checkout" },
					{ id: "svc-b", name: "payments", displayName: null },
				],
				[{ id: "svc-b", name: "payments", displayName: null }],
			]);
		});

		it("says when the latest run last moved, what it last said while live, and its top evidence once done (#743)", async () => {
			const at = new Date("2026-10-01T10:00:00Z");
			mockPrisma.incident.findMany.mockResolvedValue([
				{ id: "inc-1", service: null, investigations: [{ id: "run-live", status: "running" }] },
				{ id: "inc-2", service: null, investigations: [{ id: "run-done", status: "completed" }, { id: "old", status: "failed" }] },
			]);
			mockPrisma.incident.count.mockResolvedValue(2);
			mockPrisma.investigationEvent.groupBy.mockResolvedValueOnce([
				{ investigationId: "run-live", _max: { createdAt: at } },
			]);
			mockPrisma.investigationEvent.findFirst.mockResolvedValueOnce({
				investigationId: "run-live",
				event: JSON.stringify({ kind: "agent_step", text: "  Checking the pool size.  " }),
			});
			mockPrisma.investigation.findMany.mockResolvedValueOnce([
				{ id: "run-done", report: JSON.stringify({ hypotheses: [{ evidence: [{}, {}] }] }) },
			]);

			const { data } = await service.findAll({ limit: 50, offset: 0 });

			expect(data[0]?.investigations?.[0]).toMatchObject({ lastEventAt: at, latestText: "Checking the pool size." });
			expect(data[1]?.investigations?.[0]).toMatchObject({ evidenceCount: 2, latestText: null });
			expect(data[1]?.investigations?.[1]).toEqual({ id: "old", status: "failed" });
		});

		it("filters by a service the incident or any of its alerts touches (#743)", async () => {
			mockPrisma.incident.findMany.mockResolvedValue([]);
			mockPrisma.incident.count.mockResolvedValue(0);

			await service.findAll({ serviceId: "svc-b" });

			const [{ where }] = mockPrisma.incident.findMany.mock.calls[0];
			expect(where.OR).toEqual([
				{ serviceId: "svc-b" },
				{ alerts: { some: { serviceId: "svc-b" } } },
			]);
		});

		it("does not filter the latest investigation to status=completed", async () => {
			// The bug: filtering to `completed` here means a `running`
			// investigation can never reach the dashboard, so its progress bar
			// (gated on status === "running") could never render.
			mockPrisma.incident.findMany.mockResolvedValue([]);
			mockPrisma.incident.count.mockResolvedValue(0);

			await service.findAll({ limit: 50, offset: 0 });

			const [{ include }] = mockPrisma.incident.findMany.mock.calls[0];
			expect(include.investigations.where).toBeUndefined();
		});

		it("includes multiple investigations so older completed investigations remain available alongside newer running ones", async () => {
			mockPrisma.incident.findMany.mockResolvedValue([]);
			mockPrisma.incident.count.mockResolvedValue(0);

			await service.findAll({ limit: 50, offset: 0 });

			const [{ include }] = mockPrisma.incident.findMany.mock.calls[0];
			expect(include.investigations.take).toBeGreaterThanOrEqual(2);
		});
	});

	describe("findAll open filter", () => {
		it("narrows to the contracts' open statuses when asked and no status is set", async () => {
			mockPrisma.incident.findMany.mockResolvedValue([]);
			mockPrisma.incident.count.mockResolvedValue(0);
			await service.findAll({ open: true });
			expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						status: { in: ["triggered", "investigating", "identified", "monitoring"] },
					}),
				}),
			);
		});

		it("lets an explicit status win over open", async () => {
			mockPrisma.incident.findMany.mockResolvedValue([]);
			mockPrisma.incident.count.mockResolvedValue(0);
			await service.findAll({ open: true, status: "closed" });
			expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ status: "closed" }),
				}),
			);
		});
	});

	describe("getStats", () => {
		it("counts the window and names what needs a human with the shared predicate", async () => {
			mockPrisma.incident.groupBy
				.mockResolvedValueOnce([
					{ status: "triggered", _count: 2 },
					{ status: "investigating", _count: 1 },
					{ status: "resolved", _count: 1 },
					{ status: "closed", _count: 3 },
				])
				.mockResolvedValueOnce([
					{ severity: "critical", _count: 1 },
					{ severity: "medium", _count: 6 },
				]);
			mockPrisma.incident.aggregate.mockResolvedValue({
				_avg: { timeToResolve: 900 },
			});
			mockPrisma.incident.findMany.mockResolvedValue([
				{ status: "triggered", investigations: [] },
				{ status: "triggered", investigations: [{ status: "failed" }] },
				{ status: "investigating", investigations: [{ status: "running" }] },
				{ status: "resolved", investigations: [{ status: "completed" }] },
			]);

			const stats = await service.getStats({});

			expect(stats).toEqual({
				total: 7,
				open: 3,
				byStatus: { triggered: 2, investigating: 1, resolved: 1, closed: 3 },
				bySeverity: { critical: 1, medium: 6 },
				attention: { failed_run: 1, unacknowledged: 1, awaiting_close: 1 },
				avgTimeToResolve: 900,
			});
			expect(mockPrisma.incident.aggregate).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						status: { in: ["resolved", "closed"] },
						timeToResolve: { not: null },
					}),
				}),
			);
		});
	});
});
