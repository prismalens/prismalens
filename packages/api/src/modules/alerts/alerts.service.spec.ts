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
		create: jest.fn(),
		findUnique: jest.fn(),
		findFirst: jest.fn(),
		findMany: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
		count: jest.fn(),
		groupBy: jest.fn(),
	},
};

describe("AlertsService (BDD)", () => {
	let service: AlertsService;

	beforeEach(async () => {
		jest.clearAllMocks();
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});

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
				severity: Severity.HIGH,
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
				severity: Severity.HIGH,
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
		it("should return all alerts", async () => {
			const alerts = AlertFactory.createMany(3);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);

			const result = await service.findAll();

			expect(result).toEqual(alerts);
			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {},
					orderBy: { triggeredAt: "desc" },
				}),
			);
		});

		it("should filter by status", async () => {
			const alerts = AlertFactory.createMany(2, { status: "acknowledged" });
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);

			await service.findAll({ status: "acknowledged" });

			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { status: "acknowledged" },
				}),
			);
		});

		it("should apply pagination", async () => {
			const alerts = AlertFactory.createMany(1);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);

			await service.findAll({ limit: 10, offset: 20 });

			expect(mockPrismaService.alert.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					take: 10,
					skip: 20,
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
