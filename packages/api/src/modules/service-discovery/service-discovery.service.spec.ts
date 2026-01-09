import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import type {
	AcceptBulkSuggestionsDto,
	AcceptSuggestionDto,
} from "./dto/index.js";
import { ServiceDiscoveryService } from "./service-discovery.service.js";

const mockPrismaService = {
	integrationConnection: {
		findUnique: jest.fn(),
	},
	serviceSuggestion: {
		findMany: jest.fn(),
		findFirst: jest.fn(),
		findUnique: jest.fn(),
		create: jest.fn(),
		update: jest.fn(),
	},
	service: {
		create: jest.fn(),
	},
};

describe("ServiceDiscoveryService (BDD)", () => {
	let service: ServiceDiscoveryService;

	beforeEach(async () => {
		jest.clearAllMocks();
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ServiceDiscoveryService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<ServiceDiscoveryService>(ServiceDiscoveryService);
	});

	describe("discoverFromConnection", () => {
		it("should throw NotFoundException when connection not found", async () => {
			mockPrismaService.integrationConnection.findUnique.mockResolvedValue(
				null,
			);

			await expect(
				service.discoverFromConnection("non-existent"),
			).rejects.toThrow(NotFoundException);
		});

		it("should throw BadRequestException for non-code_source integrations", async () => {
			const connection = {
				id: "conn-123",
				name: "My Datadog",
				definition: { category: "monitoring", name: "datadog" },
			};

			mockPrismaService.integrationConnection.findUnique.mockResolvedValue(
				connection,
			);

			await expect(service.discoverFromConnection("conn-123")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should route GitHub connections to discoverFromGitHub", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitHub",
				config: JSON.stringify({ repositories: ["org/repo"] }),
				definition: { category: "code_source", name: "github" },
			};

			mockPrismaService.integrationConnection.findUnique.mockResolvedValue(
				connection,
			);
			mockPrismaService.serviceSuggestion.findFirst.mockResolvedValue(null);
			mockPrismaService.serviceSuggestion.create.mockResolvedValue({
				id: "sugg-123",
				connectionId: "conn-123",
				suggestedName: "repo",
				displayName: "Repo",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const result = await service.discoverFromConnection("conn-123");

			expect(result).toHaveLength(1);
			expect(mockPrismaService.serviceSuggestion.create).toHaveBeenCalled();
		});

		it("should throw BadRequestException for unsupported discovery providers", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitLab",
				definition: { category: "code_source", name: "gitlab" },
			};

			mockPrismaService.integrationConnection.findUnique.mockResolvedValue(
				connection,
			);

			await expect(service.discoverFromConnection("conn-123")).rejects.toThrow(
				BadRequestException,
			);
		});
	});

	describe("discoverFromGitHub", () => {
		it("should warn when no repositories configured", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitHub",
				config: JSON.stringify({ repositories: [] }),
				definition: { category: "code_source", name: "github" },
			};

			const result = await service.discoverFromGitHub(connection);

			expect(result).toEqual([]);
			expect(Logger.prototype.warn).toHaveBeenCalledWith(
				"No repositories configured for GitHub connection",
			);
		});

		it("should create service suggestions from discovered repositories", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitHub",
				config: JSON.stringify({ repositories: ["org/repo"] }),
				definition: { category: "code_source", name: "github" },
			};

			mockPrismaService.serviceSuggestion.findFirst.mockResolvedValue(null);
			mockPrismaService.serviceSuggestion.create.mockResolvedValue({
				id: "sugg-123",
				connectionId: "conn-123",
				suggestedName: "repo",
				displayName: "Repo",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: JSON.stringify({ discoveryMethod: "github" }),
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const result = await service.discoverFromGitHub(connection);

			expect(result).toHaveLength(1);
			expect(result[0].suggestedName).toBe("repo");
		});

		it("should update existing non-rejected suggestions", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitHub",
				config: JSON.stringify({ repositories: ["org/repo"] }),
				definition: { category: "code_source", name: "github" },
			};

			const existingSuggestion = {
				id: "sugg-123",
				connectionId: "conn-123",
				suggestedName: "repo",
				displayName: "Repo",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findFirst.mockResolvedValue(
				existingSuggestion,
			);
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...existingSuggestion,
				updatedAt: new Date(),
			});

			const result = await service.discoverFromGitHub(connection);

			expect(result).toHaveLength(1);
			expect(mockPrismaService.serviceSuggestion.update).toHaveBeenCalledWith({
				where: { id: "sugg-123" },
				data: { updatedAt: expect.any(Date) },
			});
		});

		it("should not update rejected or ignored suggestions", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitHub",
				config: JSON.stringify({ repositories: ["org/repo"] }),
				definition: { category: "code_source", name: "github" },
			};

			const rejectedSuggestion = {
				id: "sugg-123",
				status: "rejected",
			};

			mockPrismaService.serviceSuggestion.findFirst.mockResolvedValue(
				rejectedSuggestion,
			);
			mockPrismaService.serviceSuggestion.create.mockResolvedValue({
				id: "sugg-124",
				connectionId: "conn-123",
				suggestedName: "repo",
				displayName: "Repo",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const result = await service.discoverFromGitHub(connection);

			expect(mockPrismaService.serviceSuggestion.update).not.toHaveBeenCalled();
			expect(mockPrismaService.serviceSuggestion.create).toHaveBeenCalled();
		});

		it("should handle errors when discovering repositories", async () => {
			const connection = {
				id: "conn-123",
				name: "My GitHub",
				config: JSON.stringify({ repositories: ["org/repo1", "org/repo2"] }),
				definition: { category: "code_source", name: "github" },
			};

			mockPrismaService.serviceSuggestion.findFirst.mockImplementation(() => {
				throw new Error("DB Error");
			});

			const result = await service.discoverFromGitHub(connection);

			expect(result).toEqual([]);
			expect(Logger.prototype.error).toHaveBeenCalled();
		});
	});

	describe("getPendingSuggestions", () => {
		it("should return all pending suggestions", async () => {
			const suggestions = [
				{
					id: "sugg-1",
					suggestedName: "service-1",
					status: "pending",
					createdAt: new Date(),
					connectionId: "conn-1",
					displayName: "Service 1",
					repository: "org/repo",
					subPath: null,
					isMonorepo: false,
					metadata: "{}",
					updatedAt: new Date(),
				},
				{
					id: "sugg-2",
					suggestedName: "service-2",
					status: "pending",
					createdAt: new Date(),
					connectionId: "conn-1",
					displayName: "Service 2",
					repository: "org/repo",
					subPath: null,
					isMonorepo: false,
					metadata: "{}",
					updatedAt: new Date(),
				},
			];

			mockPrismaService.serviceSuggestion.findMany.mockResolvedValue(
				suggestions,
			);

			const result = await service.getPendingSuggestions();

			expect(result).toEqual(suggestions);
			expect(mockPrismaService.serviceSuggestion.findMany).toHaveBeenCalledWith(
				{
					where: { status: "pending" },
					orderBy: { createdAt: "desc" },
				},
			);
		});

		it("should return empty list when no suggestions pending", async () => {
			mockPrismaService.serviceSuggestion.findMany.mockResolvedValue([]);

			const result = await service.getPendingSuggestions();

			expect(result).toEqual([]);
		});
	});

	describe("acceptSuggestion", () => {
		it("should throw NotFoundException when suggestion not found", async () => {
			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(null);

			await expect(service.acceptSuggestion("non-existent")).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw BadRequestException for non-pending suggestions", async () => {
			const suggestion = {
				id: "sugg-123",
				status: "rejected",
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);

			await expect(service.acceptSuggestion("sugg-123")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should create a service from pending suggestion", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const createdService = {
				id: "service-123",
				name: "my-api",
				displayName: "My API",
				description: null,
				type: "service",
				team: null,
				discoverySource: "github",
				discoveryMetadata: JSON.stringify({
					repository: "org/repo",
					subPath: null,
					isMonorepo: false,
				}),
				isDiscovered: true,
				isConfirmed: true,
				discoveryPath: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.service.create.mockResolvedValue(createdService);
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...suggestion,
				status: "accepted",
			});

			const result = await service.acceptSuggestion("sugg-123");

			expect(result).toEqual(createdService);
			expect(mockPrismaService.service.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					name: "my-api",
					displayName: "My API",
					discoverySource: "github",
					isDiscovered: true,
					isConfirmed: true,
				}),
			});
		});

		it("should accept with overrides", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const overrides: AcceptSuggestionDto = {
				name: "custom-name",
				displayName: "Custom Display Name",
				description: "Custom description",
				type: "microservice",
				team: "platform",
			};

			const createdService = {
				id: "service-123",
				name: "custom-name",
				displayName: "Custom Display Name",
				description: "Custom description",
				type: "microservice",
				team: "platform",
				discoverySource: "github",
				discoveryMetadata: "{}",
				isDiscovered: true,
				isConfirmed: true,
				discoveryPath: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.service.create.mockResolvedValue(createdService);
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...suggestion,
				status: "accepted",
			});

			const result = await service.acceptSuggestion("sugg-123", overrides);

			expect(result.name).toBe("custom-name");
			expect(result.team).toBe("platform");
		});

		it("should mark suggestion as accepted", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.service.create.mockResolvedValue({
				id: "service-123",
				name: "my-api",
				displayName: "My API",
				description: null,
				type: "service",
				team: null,
				discoverySource: "github",
				discoveryMetadata: "{}",
				isDiscovered: true,
				isConfirmed: true,
				discoveryPath: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...suggestion,
				status: "accepted",
			});

			await service.acceptSuggestion("sugg-123");

			expect(mockPrismaService.serviceSuggestion.update).toHaveBeenCalledWith({
				where: { id: "sugg-123" },
				data: { status: "accepted" },
			});
		});
	});

	describe("rejectSuggestion", () => {
		it("should throw NotFoundException when suggestion not found", async () => {
			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(null);

			await expect(service.rejectSuggestion("non-existent")).rejects.toThrow(
				NotFoundException,
			);
		});

		it("should throw BadRequestException for non-pending suggestions", async () => {
			const suggestion = {
				id: "sugg-123",
				status: "accepted",
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);

			await expect(service.rejectSuggestion("sugg-123")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should mark suggestion as rejected", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				status: "pending",
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...suggestion,
				status: "rejected",
			});

			await service.rejectSuggestion("sugg-123");

			expect(mockPrismaService.serviceSuggestion.update).toHaveBeenCalledWith({
				where: { id: "sugg-123" },
				data: { status: "rejected" },
			});
		});

		it("should log rejection", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				status: "pending",
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...suggestion,
				status: "rejected",
			});

			await service.rejectSuggestion("sugg-123");

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Rejected service suggestion"),
			);
		});
	});

	describe("acceptMultiple", () => {
		it("should accept multiple suggestions", async () => {
			const suggestion1 = {
				id: "sugg-1",
				suggestedName: "service-1",
				displayName: "Service 1",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const suggestion2 = {
				id: "sugg-2",
				suggestedName: "service-2",
				displayName: "Service 2",
				repository: "org/repo",
				subPath: "packages/lib",
				isMonorepo: true,
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const service1 = {
				id: "service-1",
				name: "service-1",
				displayName: "Service 1",
				description: null,
				type: "service",
				team: "platform",
				discoverySource: "github",
				discoveryMetadata: "{}",
				isDiscovered: true,
				isConfirmed: true,
				discoveryPath: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const service2 = {
				id: "service-2",
				name: "service-2",
				displayName: "Service 2",
				description: null,
				type: "microservice",
				team: "platform",
				discoverySource: "github",
				discoveryMetadata: "{}",
				isDiscovered: true,
				isConfirmed: true,
				discoveryPath: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique
				.mockResolvedValueOnce(suggestion1)
				.mockResolvedValueOnce(suggestion2);

			mockPrismaService.service.create
				.mockResolvedValueOnce(service1)
				.mockResolvedValueOnce(service2);

			mockPrismaService.serviceSuggestion.update
				.mockResolvedValueOnce({ ...suggestion1, status: "accepted" })
				.mockResolvedValueOnce({ ...suggestion2, status: "accepted" });

			const overrides: AcceptBulkSuggestionsDto["overrides"] = {
				type: "microservice",
				team: "platform",
			};

			const result = await service.acceptMultiple(
				["sugg-1", "sugg-2"],
				overrides,
			);

			expect(result).toHaveLength(2);
			expect(mockPrismaService.service.create).toHaveBeenCalledTimes(2);
		});

		it("should handle errors when accepting individual suggestions", async () => {
			const suggestion1 = {
				id: "sugg-1",
				suggestedName: "service-1",
				displayName: "Service 1",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique
				.mockResolvedValueOnce(suggestion1)
				.mockResolvedValueOnce(null);

			mockPrismaService.service.create.mockResolvedValueOnce({
				id: "service-1",
				name: "service-1",
				displayName: "Service 1",
				description: null,
				type: "service",
				team: null,
				discoverySource: "github",
				discoveryMetadata: "{}",
				isDiscovered: true,
				isConfirmed: true,
				discoveryPath: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			mockPrismaService.serviceSuggestion.update.mockResolvedValueOnce({
				...suggestion1,
				status: "accepted",
			});

			const result = await service.acceptMultiple(["sugg-1", "sugg-2"]);

			expect(result).toHaveLength(1);
			expect(Logger.prototype.error).toHaveBeenCalled();
		});
	});
});
