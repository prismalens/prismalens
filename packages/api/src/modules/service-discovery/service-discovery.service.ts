import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import {
	IntegrationConnection,
	Service,
	ServiceSuggestion,
} from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { AcceptBulkSuggestionsDto, AcceptSuggestionDto } from "./dto/index.js";

export interface DiscoveredService {
	name: string;
	path: string;
	isMonorepo?: boolean;
}

@Injectable()
export class ServiceDiscoveryService {
	private readonly logger = new Logger(ServiceDiscoveryService.name);

	constructor(private readonly prisma: PrismaService) {}

	// =========================================================================
	// DISCOVERY TRIGGER
	// =========================================================================

	/**
	 * Trigger service discovery for a given integration connection.
	 * This will analyze repositories and create ServiceSuggestion records.
	 */
	async discoverFromConnection(
		connectionId: string,
	): Promise<ServiceSuggestion[]> {
		const connection = await this.prisma.integrationConnection.findUnique({
			where: { id: connectionId },
			include: { definition: true },
		});

		if (!connection) {
			throw new NotFoundException("Integration connection not found");
		}

		// Only code_source integrations support discovery
		if (connection.definition.category !== "code_source") {
			throw new BadRequestException(
				`Integration "${connection.definition.name}" does not support service discovery`,
			);
		}

		// Route to provider-specific discovery
		if (connection.definition.name === "github") {
			return this.discoverFromGitHub(connection);
		}

		// Future: gitlab, bitbucket, etc.
		throw new BadRequestException(
			`Service discovery not yet implemented for "${connection.definition.name}"`,
		);
	}

	/**
	 * Discover services from GitHub repositories.
	 * This is a stub - in production would call GitHub API.
	 */
	async discoverFromGitHub(
		connection: IntegrationConnection,
	): Promise<ServiceSuggestion[]> {
		this.logger.log(
			`Discovering services from GitHub connection: ${connection.name}`,
		);

		// Parse config to get repositories
		const config = connection.config ? JSON.parse(connection.config) : {};
		const repositories = (config.repositories || []) as string[];

		if (repositories.length === 0) {
			this.logger.warn("No repositories configured for GitHub connection");
			return [];
		}

		const suggestions: ServiceSuggestion[] = [];

		for (const repo of repositories) {
			try {
				// Analyze repo structure (stub - in production would call GitHub API)
				const { isMonorepo, services } = await this.analyzeRepoStructure(
					repo,
					connection,
				);

				for (const service of services) {
					// Determine subPath value (null for root, string for subdirectories)
					const subPath: string | null =
						service.path === "." ? null : service.path;

					// Check if suggestion already exists using findFirst to handle nullable subPath
					const existing = await this.prisma.serviceSuggestion.findFirst({
						where: {
							connectionId: connection.id,
							repository: repo,
							subPath: subPath,
						},
					});

					if (
						existing &&
						existing.status !== "rejected" &&
						existing.status !== "ignored"
					) {
						// Update existing suggestion
						const updated = await this.prisma.serviceSuggestion.update({
							where: { id: existing.id },
							data: { updatedAt: new Date() },
						});
						suggestions.push(updated);
					} else {
						// Create new suggestion
						const createData: any = {
							connectionId: connection.id,
							suggestedName: service.name,
							displayName: service.name.replace(/-/g, " "),
							repository: repo,
							isMonorepo,
							status: "pending",
							metadata: JSON.stringify({
								discoveryMethod: "github",
								discoveredAt: new Date().toISOString(),
							}),
						};

						// Include subPath (can be null)
						if (subPath !== null) {
							createData.subPath = subPath;
						}

						const suggestion = await this.prisma.serviceSuggestion.create({
							data: createData,
						});
						suggestions.push(suggestion);
					}
				}
			} catch (error) {
				this.logger.error(`Error discovering services from ${repo}:`, error);
			}
		}

		return suggestions;
	}

	/**
	 * Analyze repository structure to detect services.
	 * Returns monorepo status and list of services found.
	 * This is a stub - in production would call GitHub API.
	 */
	async analyzeRepoStructure(
		repo: string,
		connection: IntegrationConnection,
	): Promise<{
		isMonorepo: boolean;
		services: DiscoveredService[];
	}> {
		this.logger.log(`Analyzing repo structure: ${repo}`);

		// Stub: Just return the repo as a single service
		// In production, would:
		// 1. Check for monorepo indicators (package.json workspaces, lerna.json, etc.)
		// 2. Call GitHub API to list tree structure
		// 3. Detect service boundaries (package.json, Dockerfile, etc.)

		return {
			isMonorepo: false,
			services: [
				{
					name: repo.split("/")[1] || repo, // Use repo name as service name
					path: ".",
				},
			],
		};
	}

	// =========================================================================
	// SUGGESTION MANAGEMENT
	// =========================================================================

	/**
	 * Get all pending service suggestions.
	 */
	async getPendingSuggestions(): Promise<ServiceSuggestion[]> {
		return this.prisma.serviceSuggestion.findMany({
			where: { status: "pending" },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Accept a service suggestion and create a Service.
	 */
	async acceptSuggestion(
		suggestionId: string,
		overrides?: AcceptSuggestionDto,
	): Promise<Service> {
		const suggestion = await this.prisma.serviceSuggestion.findUnique({
			where: { id: suggestionId },
		});

		if (!suggestion) {
			throw new NotFoundException("Service suggestion not found");
		}

		if (suggestion.status !== "pending") {
			throw new BadRequestException(
				`Cannot accept suggestion with status: ${suggestion.status}`,
			);
		}

		// Create the service
		const serviceName = overrides?.name || suggestion.suggestedName;

		const service = await this.prisma.service.create({
			data: {
				name: serviceName,
				displayName:
					overrides?.displayName || suggestion.displayName || serviceName,
				description: overrides?.description,
				type: overrides?.type || "service",
				team: overrides?.team,
				discoverySource: "github",
				discoveryMetadata: JSON.stringify({
					repository: suggestion.repository,
					subPath: suggestion.subPath,
					isMonorepo: suggestion.isMonorepo,
				}),
				isDiscovered: true,
				isConfirmed: true,
			},
		});

		// Mark suggestion as accepted
		await this.prisma.serviceSuggestion.update({
			where: { id: suggestionId },
			data: { status: "accepted" },
		});

		this.logger.log(
			`Accepted service suggestion: ${serviceName} (${service.id})`,
		);

		return service;
	}

	/**
	 * Reject a service suggestion.
	 */
	async rejectSuggestion(suggestionId: string): Promise<void> {
		const suggestion = await this.prisma.serviceSuggestion.findUnique({
			where: { id: suggestionId },
		});

		if (!suggestion) {
			throw new NotFoundException("Service suggestion not found");
		}

		if (suggestion.status !== "pending") {
			throw new BadRequestException(
				`Cannot reject suggestion with status: ${suggestion.status}`,
			);
		}

		await this.prisma.serviceSuggestion.update({
			where: { id: suggestionId },
			data: { status: "rejected" },
		});

		this.logger.log(`Rejected service suggestion: ${suggestionId}`);
	}

	/**
	 * Accept multiple service suggestions at once.
	 */
	async acceptMultiple(
		suggestionIds: string[],
		overrides?: AcceptBulkSuggestionsDto["overrides"],
	): Promise<Service[]> {
		const services: Service[] = [];

		for (const suggestionId of suggestionIds) {
			try {
				const service = await this.acceptSuggestion(suggestionId, {
					type: overrides?.type,
					team: overrides?.team,
				});
				services.push(service);
			} catch (error) {
				this.logger.error(`Error accepting suggestion ${suggestionId}:`, error);
			}
		}

		return services;
	}
}
