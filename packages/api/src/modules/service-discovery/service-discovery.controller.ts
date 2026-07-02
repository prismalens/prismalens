import { Controller, Logger } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { serviceDiscoveryContract } from "@prismalens/contracts";
import type { ServiceSuggestion } from "@prismalens/contracts/schemas";
import type { ServiceSuggestion as PrismaServiceSuggestion } from "@prismalens/database";
import { requireAdmin } from "../../core/auth/index.js";
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
			).handler(async ({ input }) => {
				const suggestions =
					await this.serviceDiscoveryService.getSuggestions(input);
				return suggestions.map((s) => this.serializeSuggestion(s));
			}),

			// GET /service-discovery/suggestions/:id - Get a single suggestion
			getSuggestion: implement(serviceDiscoveryContract.getSuggestion).handler(
				async ({ input }) => {
					const suggestion =
						await this.serviceDiscoveryService.findSuggestionById(input.id);
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
			).handler(async ({ input, context }) => {
				requireAdmin(context);
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
			).handler(async ({ input, context }) => {
				requireAdmin(context);
				this.logger.log(`Rejecting service suggestion: ${input.id}`);
				const updated = await this.serviceDiscoveryService.rejectSuggestion(
					input.id,
				);
				return this.serializeSuggestion(updated);
			}),

			// POST /service-discovery/suggestions/:id/ignore - Ignore a suggestion
			ignoreSuggestion: implement(
				serviceDiscoveryContract.ignoreSuggestion,
			).handler(async ({ input, context }) => {
				requireAdmin(context);
				this.logger.log(`Ignoring service suggestion: ${input.id}`);
				const updated = await this.serviceDiscoveryService.ignoreSuggestion(
					input.id,
				);
				return this.serializeSuggestion(updated);
			}),

			// POST /service-discovery/suggestions/bulk-accept - Accept multiple suggestions
			acceptBulkSuggestions: implement(
				serviceDiscoveryContract.acceptBulkSuggestions,
			).handler(async ({ input, context }) => {
				requireAdmin(context);
				this.logger.log(
					`Accepting ${input.suggestionIds.length} service suggestions`,
				);
				const services = await this.serviceDiscoveryService.acceptMultiple(
					input.suggestionIds,
				);
				return {
					accepted: services.length,
					services: services.map((s, idx) => ({
						serviceId: s.id,
						serviceName: s.name,
						suggestionId: input.suggestionIds[idx] ?? "",
					})),
				};
			}),

			// POST /service-discovery/discover - Trigger service discovery
			triggerDiscovery: implement(
				serviceDiscoveryContract.triggerDiscovery,
			).handler(async ({ input, context }) => {
				requireAdmin(context);
				this.logger.log(
					`Triggering service discovery for connection: ${input.connectionId}`,
				);
				const suggestions =
					await this.serviceDiscoveryService.discoverFromConnection(
						input.connectionId,
					);
				return {
					discovered: suggestions.length,
					suggestions: suggestions.map((s) => this.serializeSuggestion(s)),
				};
			}),
		};
	}

	private serializeSuggestion(
		suggestion: PrismaServiceSuggestion,
	): ServiceSuggestion {
		let metadata: Record<string, unknown> | null = null;
		if (suggestion.metadata) {
			try {
				metadata =
					typeof suggestion.metadata === "string"
						? JSON.parse(suggestion.metadata)
						: suggestion.metadata;
			} catch {
				this.logger.warn(
					`Failed to parse metadata for suggestion ${suggestion.id}`,
				);
			}
		}

		return {
			id: suggestion.id,
			displayName: suggestion.displayName ?? null,
			repository: suggestion.repository ?? "",
			metadata,
			status: suggestion.status ?? "pending",
			connectionId: suggestion.connectionId ?? "",
			suggestedName: suggestion.suggestedName ?? "",
			isMonorepo: suggestion.isMonorepo ?? false,
			subPath: suggestion.subPath ?? null,
			sourceType:
				((suggestion as Record<string, unknown>).sourceType as string) ??
				"repository",
			statusChangedAt: suggestion.statusChangedAt?.toISOString() ?? null,
			acceptedServiceId: suggestion.acceptedServiceId ?? null,
			acceptedDeploymentId: suggestion.acceptedDeploymentId ?? null,
			createdAt: suggestion.createdAt.toISOString(),
			updatedAt: suggestion.updatedAt.toISOString(),
		} as ServiceSuggestion;
	}
}
