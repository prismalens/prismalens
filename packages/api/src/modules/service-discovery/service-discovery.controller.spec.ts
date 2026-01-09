import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type {
	AcceptBulkSuggestionsDto,
	AcceptSuggestionDto,
} from "./dto/index.js";
import { ServiceDiscoveryController } from "./service-discovery.controller.js";
import { ServiceDiscoveryService } from "./service-discovery.service.js";

const mockServiceDiscoveryService = {
	discoverFromConnection: jest.fn(),
	getPendingSuggestions: jest.fn(),
	acceptSuggestion: jest.fn(),
	rejectSuggestion: jest.fn(),
	acceptMultiple: jest.fn(),
};

describe("ServiceDiscoveryController (BDD)", () => {
	let controller: ServiceDiscoveryController;
	let service: ServiceDiscoveryService;

	beforeEach(async () => {
		jest.clearAllMocks();
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			controllers: [ServiceDiscoveryController],
			providers: [
				{
					provide: ServiceDiscoveryService,
					useValue: mockServiceDiscoveryService,
				},
			],
		}).compile();

		controller = module.get<ServiceDiscoveryController>(
			ServiceDiscoveryController,
		);
		service = module.get<ServiceDiscoveryService>(ServiceDiscoveryService);
	});

	describe("triggerDiscovery", () => {
		it("should trigger discovery for connection", async () => {
			const connectionId = "conn-123";
			const suggestions = [
				{
					id: "sugg-1",
					suggestedName: "service-1",
					displayName: "Service 1",
					repository: "org/repo",
					subPath: null,
					isMonorepo: false,
					status: "pending",
					metadata: "{}",
					connectionId: connectionId,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			mockServiceDiscoveryService.discoverFromConnection.mockResolvedValue(
				suggestions,
			);

			const result = await controller.triggerDiscovery(connectionId);

			expect(result).toEqual(suggestions);
			expect(service.discoverFromConnection).toHaveBeenCalledWith(connectionId);
		});

		it("should log discovery trigger", async () => {
			const connectionId = "conn-123";
			mockServiceDiscoveryService.discoverFromConnection.mockResolvedValue([]);

			await controller.triggerDiscovery(connectionId);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Triggering service discovery"),
			);
		});
	});

	describe("getPendingSuggestions", () => {
		it("should return all pending suggestions", async () => {
			const suggestions = [
				{
					id: "sugg-1",
					suggestedName: "service-1",
					displayName: "Service 1",
					repository: "org/repo",
					subPath: null,
					isMonorepo: false,
					status: "pending",
					metadata: "{}",
					connectionId: "conn-1",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "sugg-2",
					suggestedName: "service-2",
					displayName: "Service 2",
					repository: "org/repo",
					subPath: "packages/lib",
					isMonorepo: true,
					status: "pending",
					metadata: "{}",
					connectionId: "conn-1",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			mockServiceDiscoveryService.getPendingSuggestions.mockResolvedValue(
				suggestions,
			);

			const result = await controller.getPendingSuggestions();

			expect(result).toEqual(suggestions);
			expect(service.getPendingSuggestions).toHaveBeenCalled();
		});

		it("should return empty list when no suggestions pending", async () => {
			mockServiceDiscoveryService.getPendingSuggestions.mockResolvedValue([]);

			const result = await controller.getPendingSuggestions();

			expect(result).toEqual([]);
		});
	});

	describe("acceptSuggestion", () => {
		it("should accept suggestion without overrides", async () => {
			const suggestionId = "sugg-123";
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

			mockServiceDiscoveryService.acceptSuggestion.mockResolvedValue(
				createdService,
			);

			const result = await controller.acceptSuggestion(suggestionId);

			expect(result).toEqual(createdService);
			expect(service.acceptSuggestion).toHaveBeenCalledWith(
				suggestionId,
				undefined,
			);
		});

		it("should accept suggestion with overrides", async () => {
			const suggestionId = "sugg-123";
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

			mockServiceDiscoveryService.acceptSuggestion.mockResolvedValue(
				createdService,
			);

			const result = await controller.acceptSuggestion(suggestionId, overrides);

			expect(result).toEqual(createdService);
			expect(service.acceptSuggestion).toHaveBeenCalledWith(
				suggestionId,
				overrides,
			);
		});

		it("should log suggestion acceptance", async () => {
			const suggestionId = "sugg-123";
			mockServiceDiscoveryService.acceptSuggestion.mockResolvedValue({
				id: "service-123",
				name: "service",
				displayName: "Service",
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

			await controller.acceptSuggestion(suggestionId);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Accepting service suggestion"),
			);
		});
	});

	describe("rejectSuggestion", () => {
		it("should reject a suggestion", async () => {
			const suggestionId = "sugg-123";
			mockServiceDiscoveryService.rejectSuggestion.mockResolvedValue(undefined);

			await controller.rejectSuggestion(suggestionId);

			expect(service.rejectSuggestion).toHaveBeenCalledWith(suggestionId);
		});

		it("should log suggestion rejection", async () => {
			const suggestionId = "sugg-123";
			mockServiceDiscoveryService.rejectSuggestion.mockResolvedValue(undefined);

			await controller.rejectSuggestion(suggestionId);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Rejecting service suggestion"),
			);
		});
	});

	describe("acceptBulk", () => {
		it("should accept multiple suggestions", async () => {
			const dto: AcceptBulkSuggestionsDto = {
				suggestionIds: ["sugg-1", "sugg-2"],
				overrides: {
					type: "microservice",
					team: "platform",
				},
			};

			const services = [
				{
					id: "service-1",
					name: "service-1",
					displayName: "Service 1",
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
				},
				{
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
				},
			];

			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue(services);

			const result = await controller.acceptBulk(dto);

			expect(result).toEqual(services);
			expect(service.acceptMultiple).toHaveBeenCalledWith(
				dto.suggestionIds,
				dto.overrides,
			);
		});

		it("should handle empty suggestion list", async () => {
			const dto: AcceptBulkSuggestionsDto = {
				suggestionIds: [],
			};

			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue([]);

			const result = await controller.acceptBulk(dto);

			expect(result).toEqual([]);
		});

		it("should log bulk acceptance", async () => {
			const dto: AcceptBulkSuggestionsDto = {
				suggestionIds: ["sugg-1", "sugg-2", "sugg-3"],
				overrides: {
					type: "service",
				},
			};

			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue([]);

			await controller.acceptBulk(dto);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Accepting 3 service suggestions"),
			);
		});

		it("should accept bulk with partial services", async () => {
			const dto: AcceptBulkSuggestionsDto = {
				suggestionIds: ["sugg-1", "sugg-2", "sugg-3"],
			};

			const services = [
				{
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
				},
				{
					id: "service-2",
					name: "service-2",
					displayName: "Service 2",
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
				},
			];

			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue(services);

			const result = await controller.acceptBulk(dto);

			expect(result).toHaveLength(2);
			expect(service.acceptMultiple).toHaveBeenCalledWith(
				["sugg-1", "sugg-2", "sugg-3"],
				undefined,
			);
		});
	});
});
