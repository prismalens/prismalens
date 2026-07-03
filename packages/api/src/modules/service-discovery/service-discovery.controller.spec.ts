import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { ServiceDiscoveryController } from "./service-discovery.controller.js";
import { ServiceDiscoveryService } from "./service-discovery.service.js";

const mockServiceDiscoveryService = {
	discoverFromConnection: vi.fn(),
	acceptSuggestion: vi.fn(),
	rejectSuggestion: vi.fn(),
	acceptMultiple: vi.fn(),
};

// Every handler calls requireAdmin(context), which reads
// context.request.user.role. Supply an admin context so the business logic runs.
const adminContext = {
	request: { user: { id: "user-1", role: "admin" } },
};

describe("ServiceDiscoveryController (BDD)", () => {
	let controller: ServiceDiscoveryController;
	let service: ServiceDiscoveryService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});

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

	// Unwrap oRPC ImplementedProcedure objects: each value is a DecoratedProcedure
	// whose actual handler function lives at ['~orpc'].handler
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getHandlers(): any {
		const procedures = controller.serviceDiscovery() as Record<string, any>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		);
	}

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

			const handlers = getHandlers();
			const result = await handlers.triggerDiscovery({
				input: { connectionId },
				context: adminContext,
			} as any);

			expect(result.discovered).toBe(1);
			expect(service.discoverFromConnection).toHaveBeenCalledWith(connectionId);
		});

		it("should log discovery trigger", async () => {
			const connectionId = "conn-123";
			mockServiceDiscoveryService.discoverFromConnection.mockResolvedValue([]);

			const handlers = getHandlers();
			await handlers.triggerDiscovery({
				input: { connectionId },
				context: adminContext,
			} as any);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Triggering service discovery"),
			);
		});
	});

	describe("acceptSuggestion", () => {
		it("should accept suggestion without overrides", async () => {
			const suggestionId = "sugg-123";
			const createdService = {
				id: "service-123",
				name: "my-api",
			};

			mockServiceDiscoveryService.acceptSuggestion.mockResolvedValue(
				createdService,
			);

			const handlers = getHandlers();
			const result = await handlers.acceptSuggestion({
				input: { id: suggestionId },
				context: adminContext,
			} as any);

			expect(result).toEqual({
				serviceId: "service-123",
				serviceName: "my-api",
			});
			expect(service.acceptSuggestion).toHaveBeenCalledWith(suggestionId, {});
		});

		it("should accept suggestion with overrides", async () => {
			const suggestionId = "sugg-123";
			const overrides = {
				name: "custom-name",
				displayName: "Custom Display Name",
				description: "Custom description",
				type: "microservice",
				team: "platform",
			};

			const createdService = {
				id: "service-123",
				name: "custom-name",
			};

			mockServiceDiscoveryService.acceptSuggestion.mockResolvedValue(
				createdService,
			);

			const handlers = getHandlers();
			const result = await handlers.acceptSuggestion({
				input: { id: suggestionId, ...overrides },
				context: adminContext,
			} as any);

			expect(result).toEqual({
				serviceId: "service-123",
				serviceName: "custom-name",
			});
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
			});

			const handlers = getHandlers();
			await handlers.acceptSuggestion({
				input: { id: suggestionId },
				context: adminContext,
			} as any);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Accepting service suggestion"),
			);
		});
	});

	describe("rejectSuggestion", () => {
		it("should reject a suggestion", async () => {
			const suggestionId = "sugg-123";
			mockServiceDiscoveryService.rejectSuggestion.mockResolvedValue({
				id: suggestionId,
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "rejected",
				metadata: "{}",
				connectionId: "conn-1",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const handlers = getHandlers();
			await handlers.rejectSuggestion({
				input: { id: suggestionId },
				context: adminContext,
			} as any);

			expect(service.rejectSuggestion).toHaveBeenCalledWith(suggestionId);
		});

		it("should log suggestion rejection", async () => {
			const suggestionId = "sugg-123";
			mockServiceDiscoveryService.rejectSuggestion.mockResolvedValue({
				id: suggestionId,
				suggestedName: "my-api",
				displayName: "My API",
				repository: "org/repo",
				subPath: null,
				isMonorepo: false,
				status: "rejected",
				metadata: "{}",
				connectionId: "conn-1",
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			const handlers = getHandlers();
			await handlers.rejectSuggestion({
				input: { id: suggestionId },
				context: adminContext,
			} as any);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Rejecting service suggestion"),
			);
		});
	});

	describe("acceptBulkSuggestions", () => {
		it("should accept multiple suggestions", async () => {
			const suggestionIds = ["sugg-1", "sugg-2"];

			const services = [
				{ id: "service-1", name: "service-1" },
				{ id: "service-2", name: "service-2" },
			];

			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue(services);

			const handlers = getHandlers();
			const result = await handlers.acceptBulkSuggestions({
				input: { suggestionIds },
				context: adminContext,
			} as any);

			expect(result.accepted).toBe(2);
			expect(service.acceptMultiple).toHaveBeenCalledWith(suggestionIds);
		});

		it("should handle empty suggestion list", async () => {
			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue([]);

			const handlers = getHandlers();
			const result = await handlers.acceptBulkSuggestions({
				input: { suggestionIds: [] },
				context: adminContext,
			} as any);

			expect(result.accepted).toBe(0);
		});

		it("should log bulk acceptance", async () => {
			mockServiceDiscoveryService.acceptMultiple.mockResolvedValue([]);

			const handlers = getHandlers();
			await handlers.acceptBulkSuggestions({
				input: { suggestionIds: ["sugg-1", "sugg-2", "sugg-3"] },
				context: adminContext,
			} as any);

			expect(Logger.prototype.log).toHaveBeenCalledWith(
				expect.stringContaining("Accepting 3 service suggestions"),
			);
		});
	});
});
