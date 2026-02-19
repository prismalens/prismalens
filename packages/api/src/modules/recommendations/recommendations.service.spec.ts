import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { RecommendationFactory } from "../../../test/factories/index.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { RecommendationStatus } from "../../shared/enums/index.js";
import type { UpdateRecommendationDto } from "./dto/index.js";
import { RecommendationsService } from "./recommendations.service.js";

// Mock PrismaService to avoid Prisma import.meta issues
const mockPrismaService = {
	recommendation: {
		findUnique: jest.fn(),
		findMany: jest.fn(),
		update: jest.fn(),
		count: jest.fn(),
		groupBy: jest.fn(),
	},
};

describe("RecommendationsService (BDD)", () => {
	let service: RecommendationsService;

	beforeEach(async () => {
		jest.clearAllMocks();
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				RecommendationsService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<RecommendationsService>(RecommendationsService);
	});

	describe("findById", () => {
		it("should return recommendation when found", async () => {
			const recId = "rec-123";
			const expectedRec = RecommendationFactory.create({ id: recId });

			mockPrismaService.recommendation.findUnique.mockResolvedValue(
				expectedRec,
			);

			const result = await service.findById(recId);

			expect(result).toEqual(expectedRec);
			expect(mockPrismaService.recommendation.findUnique).toHaveBeenCalledWith({
				where: { id: recId },
				include: expect.objectContaining({
					investigation: expect.any(Object),
				}),
			});
		});

		it("should return null when not found", async () => {
			mockPrismaService.recommendation.findUnique.mockResolvedValue(null);

			const result = await service.findById("non-existent");

			expect(result).toBeNull();
		});
	});

	describe("findByInvestigationId", () => {
		it("should return recommendations for investigation", async () => {
			const investigationId = "inv-123";
			const recs = RecommendationFactory.createMany(3, { investigationId });

			mockPrismaService.recommendation.findMany.mockResolvedValue(recs);

			const result = await service.findByInvestigationId(investigationId);

			expect(result).toHaveLength(3);
			expect(mockPrismaService.recommendation.findMany).toHaveBeenCalledWith({
				where: { investigationId },
				orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
			});
		});

		it("should return empty array when no recommendations exist", async () => {
			mockPrismaService.recommendation.findMany.mockResolvedValue([]);

			const result = await service.findByInvestigationId("inv-no-recs");

			expect(result).toEqual([]);
		});
	});

	describe("findAll", () => {
		it("should return all recommendations", async () => {
			const recs = RecommendationFactory.createMany(5);
			mockPrismaService.recommendation.findMany.mockResolvedValue(recs);

			const result = await service.findAll();

			expect(result).toEqual(recs);
			expect(mockPrismaService.recommendation.findMany).toHaveBeenCalledWith({
				where: {},
				include: expect.objectContaining({
					investigation: expect.any(Object),
				}),
				orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
				take: undefined,
				skip: undefined,
			});
		});

		it("should filter by status", async () => {
			const recs = RecommendationFactory.createMany(2, { status: "resolved" });
			mockPrismaService.recommendation.findMany.mockResolvedValue(recs);

			await service.findAll({ status: "resolved" });

			expect(mockPrismaService.recommendation.findMany).toHaveBeenCalledWith({
				where: { status: "resolved" },
				include: expect.objectContaining({
					investigation: expect.any(Object),
				}),
				orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
				take: undefined,
				skip: undefined,
			});
		});

		it("should filter by priority", async () => {
			mockPrismaService.recommendation.findMany.mockResolvedValue([]);

			await service.findAll({ priority: "critical" });

			expect(mockPrismaService.recommendation.findMany).toHaveBeenCalledWith({
				where: { priority: "critical" },
				include: expect.objectContaining({
					investigation: expect.any(Object),
				}),
				orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
				take: undefined,
				skip: undefined,
			});
		});

		it("should apply pagination", async () => {
			mockPrismaService.recommendation.findMany.mockResolvedValue([]);

			await service.findAll({ limit: 20, offset: 40 });

			expect(mockPrismaService.recommendation.findMany).toHaveBeenCalledWith({
				where: {},
				include: expect.objectContaining({
					investigation: expect.any(Object),
				}),
				orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
				take: 20,
				skip: 40,
			});
		});

		it("should combine multiple filters", async () => {
			mockPrismaService.recommendation.findMany.mockResolvedValue([]);

			await service.findAll({
				status: "open",
				priority: "high",
				limit: 10,
				offset: 5,
			});

			expect(mockPrismaService.recommendation.findMany).toHaveBeenCalledWith({
				where: { status: "open", priority: "high" },
				include: expect.objectContaining({
					investigation: expect.any(Object),
				}),
				orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
				take: 10,
				skip: 5,
			});
		});
	});

	describe("update", () => {
		it("should update and return recommendation", async () => {
			const recId = "rec-123";
			const updateDto: UpdateRecommendationDto = { status: RecommendationStatus.COMPLETED };
			const updatedRec = RecommendationFactory.create({
				id: recId,
				...updateDto,
			});

			mockPrismaService.recommendation.update.mockResolvedValue(updatedRec);

			const result = await service.update(recId, updateDto);

			expect(result).toEqual(updatedRec);
			expect(mockPrismaService.recommendation.update).toHaveBeenCalledWith({
				where: { id: recId },
				data: expect.objectContaining({ status: RecommendationStatus.COMPLETED }),
			});
		});

		it("should return null on update failure", async () => {
			mockPrismaService.recommendation.update.mockRejectedValue(
				new Error("Not found"),
			);

			const result = await service.update("non-existent", { notes: "Some notes" });

			expect(result).toBeNull();
		});
	});

	describe("count", () => {
		it("should return total count", async () => {
			mockPrismaService.recommendation.count.mockResolvedValue(87);

			const result = await service.count();

			expect(result).toBe(87);
			expect(mockPrismaService.recommendation.count).toHaveBeenCalledWith({
				where: {},
			});
		});

		it("should count with status filter", async () => {
			mockPrismaService.recommendation.count.mockResolvedValue(42);

			await service.count({ status: "resolved" });

			expect(mockPrismaService.recommendation.count).toHaveBeenCalledWith({
				where: { status: "resolved" },
			});
		});

		it("should count with priority filter", async () => {
			mockPrismaService.recommendation.count.mockResolvedValue(7);

			await service.count({ priority: "critical" });

			expect(mockPrismaService.recommendation.count).toHaveBeenCalledWith({
				where: { priority: "critical" },
			});
		});

		it("should count with multiple filters", async () => {
			mockPrismaService.recommendation.count.mockResolvedValue(12);

			await service.count({ status: "open", priority: "high" });

			expect(mockPrismaService.recommendation.count).toHaveBeenCalledWith({
				where: { status: "open", priority: "high" },
			});
		});
	});

	describe("getStatsByStatus", () => {
		it("should return counts grouped by status", async () => {
			mockPrismaService.recommendation.groupBy.mockResolvedValue([
				{ status: "open", _count: 15 },
				{ status: "acknowledged", _count: 8 },
				{ status: "resolved", _count: 42 },
			]);

			const result = await service.getStatsByStatus();

			expect(result).toEqual({
				open: 15,
				acknowledged: 8,
				resolved: 42,
			});
			expect(mockPrismaService.recommendation.groupBy).toHaveBeenCalledWith({
				by: ["status"],
				_count: true,
			});
		});

		it("should return empty object when no recommendations exist", async () => {
			mockPrismaService.recommendation.groupBy.mockResolvedValue([]);

			const result = await service.getStatsByStatus();

			expect(result).toEqual({});
		});

		it("should handle single status", async () => {
			mockPrismaService.recommendation.groupBy.mockResolvedValue([
				{ status: "open", _count: 23 },
			]);

			const result = await service.getStatsByStatus();

			expect(result).toEqual({ open: 23 });
		});
	});
});
