// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { AlertFactory } from "../../../test/factories/index.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { Severity } from "../../shared/enums/index.js";
import { AlertsService } from "./alerts.service.js";
import type { CreateAlertDto, UpdateAlertDto } from "./dto/index.js";

// Mock PrismaService to avoid Prisma import.meta issues
const mockPrismaService = {
	alert: {
		create: vi.fn(),
		findUnique: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		count: vi.fn(),
		groupBy: vi.fn(),
	},
};

describe("AlertsService (BDD)", () => {
	let service: AlertsService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AlertsService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<AlertsService>(AlertsService);
	});

	describe("create", () => {
		it("should create alert with provided data", async () => {
			const createDto: CreateAlertDto = {
				source: "prometheus",
				sourceAlertId: "ext-123",
				title: "Database issue",
				description: "Slow query",
				severity: Severity.high,
				sourceUrl: "https://prometheus.io",
				labels: { env: "prod" },
			};

			const expectedAlert = AlertFactory.create({
				source: createDto.source,
				externalId: createDto.sourceAlertId,
				title: createDto.title,
				description: createDto.description,
				severity: createDto.severity as unknown as string,
				status: "triggered",
				dedupKey: expect.any(String) as unknown as string,
				fingerprint: expect.any(String) as unknown as string,
			});

			// First call to findUnique for dedup check returns null (no duplicate)
			mockPrismaService.alert.findUnique.mockResolvedValue(null);
			mockPrismaService.alert.create.mockResolvedValue(expectedAlert);

			const result = await service.create(createDto);

			expect(result).toEqual(expectedAlert);
			expect(mockPrismaService.alert.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					source: "prometheus",
					title: "Database issue",
					status: "triggered",
				}),
			});
		});

		it("should default severity to medium when not provided", async () => {
			const createDto: CreateAlertDto = {
				source: "github",
				title: "Issue",
				sourceUrl: "https://github.com",
			};

			const expectedAlert = AlertFactory.create({
				severity: "medium",
			});

			mockPrismaService.alert.findUnique.mockResolvedValue(null);
			mockPrismaService.alert.create.mockResolvedValue(expectedAlert);

			await service.create(createDto);

			expect(mockPrismaService.alert.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ severity: "medium" }),
			});
		});

		it("should deduplicate alerts with same dedupKey", async () => {
			const createDto: CreateAlertDto = {
				source: "prometheus",
				title: "Same alert",
				severity: Severity.high,
			};

			const existingAlert = AlertFactory.create({
				occurrenceCount: 1,
			});
			const updatedAlert = AlertFactory.create({
				...existingAlert,
				occurrenceCount: 2,
			});

			mockPrismaService.alert.findUnique.mockResolvedValue(existingAlert);
			mockPrismaService.alert.update.mockResolvedValue(updatedAlert);

			const result = await service.create(createDto);

			expect(result.occurrenceCount).toBe(2);
			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			expect(mockPrismaService.alert.update).toHaveBeenCalled();
		});
	});

	/**
	 * #231 — dedup / flap-suppression semantics on the app side, PINNED AS-IS.
	 *
	 * `AlertsService.create` is the app's only deduplication point. Everything
	 * below documents what it does today, including the parts that are wrong.
	 * Do not relax an assertion to make a behaviour change pass — change the
	 * code and the assertion together. Prose + tables:
	 * docs/alert-dedup-and-grouping.md.
	 */
	describe("#231 dedup semantics", () => {
		const dedupDto: CreateAlertDto = {
			source: "prometheus",
			title: "HighLatency",
			severity: Severity.high,
		};

		it("keys dedup on exactly source+title+severity+serviceId — description, labels and tags do not participate", () => {
			const withOneBody = service.generateDedupKey({
				...dedupDto,
				description: "p99 latency 4200ms on node-1",
				labels: { node: "node-1" },
				tags: ["latency"],
			});
			const withAnotherBody = service.generateDedupKey({
				...dedupDto,
				description: "p99 latency 90ms on node-99",
				labels: { node: "node-99" },
				tags: ["unrelated"],
			});

			// Two alerts about different nodes carrying different numbers collapse
			// into one row. The body of the alert is invisible to dedup.
			expect(withAnotherBody).toBe(withOneBody);
		});

		it("splits into a SECOND alert row the moment a flapping alert changes severity", () => {
			// A flap that escalates medium -> critical is not the same alert to
			// this key, so it creates a new row with occurrenceCount 1 instead of
			// incrementing the existing one.
			const medium = service.generateDedupKey({
				...dedupDto,
				severity: Severity.medium,
			});
			const critical = service.generateDedupKey({
				...dedupDto,
				severity: Severity.critical,
			});

			expect(critical).not.toBe(medium);
		});

		it("has NO dedup time window — the lookup is keyed on dedupKey alone, with no recency bound", async () => {
			// WRONG-BUT-PINNED (#398). `dedupKey` is a unique column and the
			// lookup carries no `triggeredAt`/`lastOccurrence` predicate, so an
			// alert that recurs a year later folds onto the original row rather
			// than being treated as a fresh occurrence worth investigating.
			mockPrismaService.alert.findUnique.mockResolvedValue(null);
			mockPrismaService.alert.create.mockResolvedValue(AlertFactory.create());

			await service.create(dedupDto);

			expect(mockPrismaService.alert.findUnique).toHaveBeenCalledWith({
				where: { dedupKey: service.generateDedupKey(dedupDto) },
			});
		});

		it("does NOT revive a resolved alert it dedups onto: status and triggeredAt are left alone", async () => {
			// WRONG-BUT-PINNED (#398). This is the app-side flap hole. A resolved
			// alert that fires again only gets occurrenceCount++ and a new
			// lastOccurrence — it stays `resolved`, so it is invisible to
			// `findUncorrelated` (which filters status: "triggered") and no new
			// incident is ever raised for the second episode.
			const resolved = AlertFactory.create({
				id: "alert-resolved",
				status: "resolved",
				occurrenceCount: 7,
				incidentId: null,
			});
			mockPrismaService.alert.findUnique.mockResolvedValue(resolved);
			mockPrismaService.alert.update.mockResolvedValue({
				...resolved,
				occurrenceCount: 8,
			});

			const result = await service.create(dedupDto);

			expect(mockPrismaService.alert.create).not.toHaveBeenCalled();
			// Exact shape, not objectContaining: adding a `status` reset here has
			// to break this test, which is the whole point of pinning it.
			expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
				where: { id: "alert-resolved" },
				data: {
					occurrenceCount: { increment: 1 },
					lastOccurrence: expect.any(Date) as unknown as Date,
					updatedAt: expect.any(Date) as unknown as Date,
				},
			});
			expect(result.status).toBe("resolved");
		});

		it("does not refresh triggeredAt on a deduped occurrence, so correlation's 60-minute windows keep measuring the FIRST sighting", async () => {
			// Downstream consequence of the update shape above: every correlation
			// tier bounds on `triggeredAt`, which dedup never moves.
			const existing = AlertFactory.create({ id: "alert-1" });
			mockPrismaService.alert.findUnique.mockResolvedValue(existing);
			mockPrismaService.alert.update.mockResolvedValue(existing);

			await service.create(dedupDto);

			const updateArg = mockPrismaService.alert.update.mock
				.calls[0][0] as unknown as { data: Record<string, unknown> };
			expect(updateArg.data).not.toHaveProperty("triggeredAt");
			expect(updateArg.data).not.toHaveProperty("status");
		});
	});

	describe("findById", () => {
		it("should return alert when found", async () => {
			const alertId = "alert-123";
			const expectedAlert = AlertFactory.create({ id: alertId });
			mockPrismaService.alert.findUnique.mockResolvedValue(expectedAlert);

			const result = await service.findById(alertId);

			expect(result).toEqual(expectedAlert);
			expect(mockPrismaService.alert.findUnique).toHaveBeenCalledWith({
				where: { id: alertId },
				include: expect.any(Object),
			});
		});

		it("should return null when alert not found", async () => {
			mockPrismaService.alert.findUnique.mockResolvedValue(null);

			const result = await service.findById("non-existent");

			expect(result).toBeNull();
		});
	});

	describe("findAll", () => {
		it("should return all alerts with total count", async () => {
			const alerts = AlertFactory.createMany(3);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);
			mockPrismaService.alert.count.mockResolvedValue(3);

			const result = await service.findAll();

			expect(result).toEqual({ data: alerts, total: 3 });
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {},
					orderBy: { triggeredAt: "desc" },
				}),
			);
			expect(mockPrismaService.alert.count).toHaveBeenCalledWith({ where: {} });
		});

		it("should filter by status and return count", async () => {
			const alerts = AlertFactory.createMany(2, { status: "acknowledged" });
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);
			mockPrismaService.alert.count.mockResolvedValue(2);

			const result = await service.findAll({ status: "acknowledged" });

			expect(result.data).toEqual(alerts);
			expect(result.total).toBe(2);
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { status: "acknowledged" },
				}),
			);
		});

		it("should apply pagination and reflect full total count even when data is truncated", async () => {
			const alerts = AlertFactory.createMany(2);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);
			mockPrismaService.alert.count.mockResolvedValue(5);

			const result = await service.findAll({ limit: 2, offset: 0 });

			expect(result.data.length).toBe(2);
			expect(result.total).toBe(5);
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					take: 2,
					skip: 0,
				}),
			);
		});
	});

	describe("update", () => {
		it("should update and return alert", async () => {
			const alertId = "alert-123";
			const updateDto: UpdateAlertDto = { title: "Updated" };
			const updatedAlert = AlertFactory.create({
				id: alertId,
				title: "Updated",
			});
			mockPrismaService.alert.update.mockResolvedValue(updatedAlert);

			const result = await service.update(alertId, updateDto);

			expect(result).toEqual(updatedAlert);
			expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
				where: { id: alertId },
				data: expect.objectContaining({ title: "Updated" }),
			});
		});

		it("should return null when update fails", async () => {
			mockPrismaService.alert.update.mockRejectedValue(new Error("Not found"));

			const result = await service.update("non-existent", { title: "Title" });

			expect(result).toBeNull();
		});
	});

	describe("updateStatus", () => {
		it("should update status", async () => {
			const alertId = "alert-123";
			const updatedAlert = AlertFactory.create({
				id: alertId,
				status: "resolved",
			});
			mockPrismaService.alert.update.mockResolvedValue(updatedAlert);

			const result = await service.updateStatus(alertId, "resolved");

			expect(result).toEqual(updatedAlert);
			expect(mockPrismaService.alert.update).toHaveBeenCalledWith({
				where: { id: alertId },
				data: expect.objectContaining({ status: "resolved" }),
			});
		});
	});

	describe("delete", () => {
		it("should delete alert and return true", async () => {
			mockPrismaService.alert.delete.mockResolvedValue(AlertFactory.create());

			const result = await service.delete("alert-123");

			expect(result).toBe(true);
			expect(mockPrismaService.alert.delete).toHaveBeenCalledWith({
				where: { id: "alert-123" },
			});
		});

		it("should return false when delete fails", async () => {
			mockPrismaService.alert.delete.mockRejectedValue(new Error("Not found"));

			const result = await service.delete("non-existent");

			expect(result).toBe(false);
		});
	});

	describe("count", () => {
		it("should return total count", async () => {
			mockPrismaService.alert.count.mockResolvedValue(42);

			const result = await service.count();

			expect(result).toBe(42);
			expect(mockPrismaService.alert.count).toHaveBeenCalledWith({
				where: {},
			});
		});

		it("should count with filters", async () => {
			mockPrismaService.alert.count.mockResolvedValue(15);

			await service.count({ status: "triggered" });

			expect(mockPrismaService.alert.count).toHaveBeenCalledWith({
				where: { status: "triggered" },
			});
		});
	});
});
