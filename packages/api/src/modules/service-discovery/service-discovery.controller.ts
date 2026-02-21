import { Controller, Logger } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { serviceDiscoveryContract } from "@prismalens/contracts";
import type { ServiceSuggestion } from "@prismalens/contracts/schemas";
import { ServiceDiscoveryService } from "./service-discovery.service.js";

@Controller()
export class ServiceDiscoveryController {
	private readonly logger = new Logger(ServiceDiscoveryController.name);

	constructor(
		private readonly serviceDiscoveryService: ServiceDiscoveryService,
	) {}

	@Implement(serviceDiscoveryContract)
	serviceDiscovery() {
		return {
			// GET /service-discovery/suggestions - List service suggestions
			listSuggestions: implement(
				serviceDiscoveryContract.listSuggestions,
			).handler(async () => {
				const suggestions =
					await this.serviceDiscoveryService.getPendingSuggestions();
				return suggestions.map((s) => this.serializeSuggestion(s));
			}),

			// GET /service-discovery/suggestions/:id - Get a single suggestion
			getSuggestion: implement(serviceDiscoveryContract.getSuggestion).handler(
				async ({ input }) => {
					// Use findById pattern since getSuggestionById doesn't exist
					const suggestions =
						await this.serviceDiscoveryService.getPendingSuggestions();
					const suggestion = suggestions.find((s) => s.id === input.id);
					if (!suggestion) {
						throw new ORPCError("NOT_FOUND", {
							message: `Suggestion ${input.id} not found`,
						});
					}
					return this.serializeSuggestion(suggestion);
				},
			),

			// POST /service-discovery/suggestions/:id/accept - Accept a suggestion
			acceptSuggestion: implement(
				serviceDiscoveryContract.acceptSuggestion,
			).handler(async ({ input }) => {
				const { id, ...overrides } = input;
				this.logger.log(`Accepting service suggestion: ${id}`);
				const service = await this.serviceDiscoveryService.acceptSuggestion(
					id,
					overrides,
				);
				return {
					serviceId: service?.id ?? "",
					serviceName: service?.name ?? "",
				};
			}),

			// POST /service-discovery/suggestions/:id/reject - Reject a suggestion
			rejectSuggestion: implement(
				serviceDiscoveryContract.rejectSuggestion,
			).handler(async ({ input }) => {
				this.logger.log(`Rejecting service suggestion: ${input.id}`);
				await this.serviceDiscoveryService.rejectSuggestion(input.id);
				// Return the updated suggestion - fetch it again
				const suggestions =
					await this.serviceDiscoveryService.getPendingSuggestions();
				const suggestion = suggestions.find((s) => s.id === input.id);
				if (suggestion) {
					return this.serializeSuggestion(suggestion);
				}
				// If not found in pending, it was rejected successfully
				return this.serializeSuggestion({ id: input.id, status: "rejected" });
			}),

			// POST /service-discovery/suggestions/:id/ignore - Ignore a suggestion
			ignoreSuggestion: implement(
				serviceDiscoveryContract.ignoreSuggestion,
			).handler(async ({ input }) => {
				this.logger.log(`Ignoring service suggestion: ${input.id}`);
				// The service doesn't have ignoreSuggestion - treat as reject
				await this.serviceDiscoveryService.rejectSuggestion(input.id);
				return this.serializeSuggestion({ id: input.id, status: "ignored" });
			}),

			// POST /service-discovery/suggestions/bulk-accept - Accept multiple suggestions
			acceptBulkSuggestions: implement(
				serviceDiscoveryContract.acceptBulkSuggestions,
			).handler(async ({ input }) => {
				this.logger.log(
					`Accepting ${input.suggestionIds.length} service suggestions`,
				);
				const services = await this.serviceDiscoveryService.acceptMultiple(
					input.suggestionIds,
				);
				return {
					accepted: services.length,
					services: services.map((s: any, idx: number) => ({
						serviceId: s.id,
						serviceName: s.name,
						suggestionId: input.suggestionIds[idx] ?? "",
					})),
				};
			}),

			// POST /service-discovery/discover - Trigger service discovery
			triggerDiscovery: implement(
				serviceDiscoveryContract.triggerDiscovery,
			).handler(async ({ input }) => {
				this.logger.log(
					`Triggering service discovery for connection: ${input.connectionId}`,
				);
				const suggestions =
					await this.serviceDiscoveryService.discoverFromConnection(
						input.connectionId,
					);
				return {
					discovered: suggestions.length,
					suggestions: suggestions.map((s: any) => this.serializeSuggestion(s)),
				};
			}),
		};
	}

	private serializeSuggestion(suggestion: Record<string, any>): ServiceSuggestion {
		return {
			id: suggestion.id,
			displayName: suggestion.displayName ?? null,
			repository: suggestion.repository ?? "",
			metadata: suggestion.metadata
				? typeof suggestion.metadata === "string"
					? JSON.parse(suggestion.metadata)
					: suggestion.metadata
				: null,
			status: suggestion.status ?? "pending",
			connectionId: suggestion.connectionId ?? "",
			suggestedName: suggestion.suggestedName ?? "",
			isMonorepo: suggestion.isMonorepo ?? false,
			subPath: suggestion.subPath ?? null,
		} as ServiceSuggestion;
	}
}
