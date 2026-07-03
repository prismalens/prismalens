import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Connection } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "../integrations/crypto/credentials.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import type {
	AcceptBulkSuggestionsDto,
	AcceptSuggestionDto,
} from "./dto/index.js";
import { ServiceDiscoveryService } from "./service-discovery.service.js";

function createMockConnection(
	overrides?: Partial<
		Connection & { integration: { templateId: string; label: string } }
	>,
): Connection & { integration: { templateId: string; label: string } } {
	return {
		id: "conn-123",
		integrationId: "int-github",
		userId: "user-1",
		organizationId: null,
		connectionConfigEnc: null,
		credentialsEnc: new Uint8Array() as Uint8Array<ArrayBuffer>,
		tokenExpiresAt: null,
		tokenType: null,
		grantedScopes: "[]",
		metadataEnc: null,
		status: "ACTIVE",
		lastUsedAt: null,
		lastRefreshedAt: null,
		lastErrorMessage: null,
		lastErrorAt: null,
		consecutiveErrors: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
		integration: {
			templateId: "github-app",
			label: "My GitHub",
		},
		...overrides,
	} as Connection & { integration: { templateId: string; label: string } };
}

const mockPrismaService = {
	connection: {
		findUnique: vi.fn(),
	},
	serviceSuggestion: {
		findMany: vi.fn(),
		findFirst: vi.fn(),
		findUnique: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
	},
	service: {
		create: vi.fn(),
		findUnique: vi.fn(),
	},
	deployment: {
		create: vi.fn(),
	},
	$transaction: vi.fn(),
};

const mockCredentialsService = {
	decrypt: vi.fn().mockReturnValue({}),
};

const mockIntegrationsService = {
	getGitRepositories: vi.fn().mockResolvedValue([]),
	createRequestFn: vi.fn(),
};

describe("ServiceDiscoveryService (BDD)", () => {
	let service: ServiceDiscoveryService;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Re-apply $transaction mock after clearAllMocks — supports both
		// batched (array) and interactive (callback) transaction forms
		mockPrismaService.$transaction.mockImplementation((arg: unknown) => {
			if (typeof arg === "function") {
				return (arg as (tx: typeof mockPrismaService) => unknown)(
					mockPrismaService,
				);
			}
			return Promise.resolve(arg);
		});
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ServiceDiscoveryService,
				{ provide: PrismaService, useValue: mockPrismaService },
				{ provide: CredentialsService, useValue: mockCredentialsService },
				{ provide: IntegrationsService, useValue: mockIntegrationsService },
			],
		}).compile();

		service = module.get<ServiceDiscoveryService>(ServiceDiscoveryService);
	});

	describe("discoverFromConnection", () => {
		it("should throw NotFoundException when connection not found", async () => {
			mockPrismaService.connection.findUnique.mockResolvedValue(null);

			await expect(
				service.discoverFromConnection("non-existent"),
			).rejects.toThrow(NotFoundException);
		});

		it("should throw BadRequestException for unsupported categories", async () => {
			const connection = createMockConnection({
				integration: {
					templateId: "datadog",
					label: "My Datadog",
				},
			});

			mockPrismaService.connection.findUnique.mockResolvedValue(connection);

			await expect(service.discoverFromConnection("conn-123")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should route GitHub connections to VCS discovery", async () => {
			const connection = createMockConnection();

			mockIntegrationsService.getGitRepositories.mockResolvedValue([
				{ fullName: "org/repo" },
			]);
			mockPrismaService.connection.findUnique.mockResolvedValue(connection);
			mockPrismaService.serviceSuggestion.findFirst.mockResolvedValue(null);
			mockPrismaService.serviceSuggestion.create.mockResolvedValue({
				id: "sugg-123",
				connectionId: "conn-123",
				suggestedName: "repo",
				displayName: "Repo",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				sourceType: "repository",
				status: "pending",
				metadata: "{}",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const result = await service.discoverFromConnection("conn-123");

			expect(result).toHaveLength(1);
			expect(mockPrismaService.serviceSuggestion.create).toHaveBeenCalled();
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
			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue({
				id: "sugg-123",
				status: "rejected",
			});

			await expect(service.acceptSuggestion("sugg-123")).rejects.toThrow(
				BadRequestException,
			);
		});

		it("should create a service from pending repository suggestion", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				sourceType: "repository",
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
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.service.create.mockResolvedValue(createdService);

			const result = await service.acceptSuggestion("sugg-123");

			expect(result).toEqual(createdService);
			expect(mockPrismaService.$transaction).toHaveBeenCalled();
		});

		it("should accept with overrides", async () => {
			const suggestion = {
				id: "sugg-123",
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				sourceType: "repository",
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
				type: "service",
				team: "platform",
			};

			const createdService = {
				id: "service-123",
				name: "custom-name",
				displayName: "Custom Display Name",
				description: "Custom description",
				type: "service",
				team: "platform",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.service.create.mockResolvedValue(createdService);

			const result = await service.acceptSuggestion("sugg-123", overrides);

			expect(result.name).toBe("custom-name");
			expect(result.team).toBe("platform");
		});

		it("should create deployment record for deployment suggestions", async () => {
			const suggestion = {
				id: "sugg-456",
				suggestedName: "todo-api",
				displayName: "Todo API",
				repository: "todo-api",
				subPath: null,
				isMonorepo: false,
				sourceType: "deployment",
				status: "pending",
				metadata: JSON.stringify({
					externalId: "srv-abc123",
					url: "https://todo-api.onrender.com",
					status: "live",
					type: "web_service",
					region: "oregon",
				}),
				connectionId: "conn-render",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const createdService = {
				id: "service-456",
				name: "todo-api",
				displayName: "Todo API",
				type: "service",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue(
				suggestion,
			);
			mockPrismaService.service.create.mockResolvedValue(createdService);
			mockPrismaService.deployment.create.mockResolvedValue({
				id: "dep-1",
				serviceId: "service-456",
			});
			mockPrismaService.serviceSuggestion.update.mockResolvedValue({
				...suggestion,
				status: "accepted",
			});

			const result = await service.acceptSuggestion("sugg-456");

			expect(result).toEqual(createdService);
			expect(mockPrismaService.deployment.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					serviceId: "service-456",
					externalId: "srv-abc123",
					name: "todo-api",
				}),
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
			mockPrismaService.serviceSuggestion.findUnique.mockResolvedValue({
				id: "sugg-123",
				status: "accepted",
			});

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
				data: { status: "rejected", statusChangedAt: expect.any(Date) },
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
				sourceType: "repository",
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
				sourceType: "repository",
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique
				.mockResolvedValueOnce(suggestion1)
				.mockResolvedValueOnce(suggestion2);

			mockPrismaService.$transaction
				.mockResolvedValueOnce([
					{ id: "service-1", name: "service-1", displayName: "Service 1" },
					{ ...suggestion1, status: "accepted" },
				])
				.mockResolvedValueOnce([
					{ id: "service-2", name: "service-2", displayName: "Service 2" },
					{ ...suggestion2, status: "accepted" },
				]);

			const overrides: AcceptBulkSuggestionsDto["overrides"] = {
				type: "service",
				team: "platform",
			};

			const result = await service.acceptMultiple(
				["sugg-1", "sugg-2"],
				overrides,
			);

			expect(result).toHaveLength(2);
		});

		it("should handle errors when accepting individual suggestions", async () => {
			const suggestion1 = {
				id: "sugg-1",
				suggestedName: "service-1",
				displayName: "Service 1",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				sourceType: "repository",
				status: "pending",
				metadata: "{}",
				connectionId: "conn-123",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.serviceSuggestion.findUnique
				.mockResolvedValueOnce(suggestion1)
				.mockResolvedValueOnce(null);

			mockPrismaService.$transaction.mockResolvedValueOnce([
				{ id: "service-1", name: "service-1", displayName: "Service 1" },
				{ ...suggestion1, status: "accepted" },
			]);

			const result = await service.acceptMultiple(["sugg-1", "sugg-2"]);

			expect(result).toHaveLength(1);
			expect(Logger.prototype.error).toHaveBeenCalled();
		});
	});
});
