import { Controller, Logger } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { integrationsContract } from "@prismalens/contracts";
import type { CreateConnectionDto, UpdateConnectionDto } from "./dto/index.js";
import { IntegrationsService } from "./integrations.service.js";

@Controller()
export class IntegrationsController {
	private readonly logger = new Logger(IntegrationsController.name);

	constructor(private readonly integrationsService: IntegrationsService) {}

	@Implement(integrationsContract)
	integrations() {
		return {
			// GET /integrations/definitions - List available integration definitions
			listDefinitions: implement(integrationsContract.listDefinitions).handler(
				async () => {
					const definitions =
						await this.integrationsService.findAllDefinitions();
					return definitions.map((d) => this.serializeDefinition(d));
				},
			),

			// GET /integrations/definitions/:id - Get a single integration definition
			getDefinition: implement(integrationsContract.getDefinition).handler(
				async ({ input }) => {
					const definition = await this.integrationsService.findDefinitionById(
						input.id,
					);
					if (!definition) {
						throw new ORPCError("NOT_FOUND", {
							message: `Integration definition ${input.id} not found`,
						});
					}
					return this.serializeDefinition(definition);
				},
			),

			// POST /integrations/connections - Create a new integration connection
			createConnection: implement(
				integrationsContract.createConnection,
			).handler(async ({ input }) => {
				const connection = await this.integrationsService.createConnection(
					input as CreateConnectionDto,
				);
				this.logger.log(`Created integration connection: ${connection.id}`);
				return this.serializeConnection(connection);
			}),

			// GET /integrations/connections - List integration connections
			listConnections: implement(integrationsContract.listConnections).handler(
				async ({ input }) => {
					const connections = await this.integrationsService.findAllConnections(
						{
							status: input.status,
						},
					);
					return connections.map((c) =>
						this.serializeConnectionWithDefinition(c),
					);
				},
			),

			// GET /integrations/connections/:id - Get a single integration connection
			getConnection: implement(integrationsContract.getConnection).handler(
				async ({ input }) => {
					const connection =
						await this.integrationsService.getConnectionWithMaskedCredentials(
							input.id,
						);
					if (!connection) {
						throw new ORPCError("NOT_FOUND", {
							message: "Connection not found",
						});
					}
					return this.serializeConnectionWithDefinition(connection);
				},
			),

			// PATCH /integrations/connections/:id - Update an integration connection
			updateConnection: implement(
				integrationsContract.updateConnection,
			).handler(async ({ input }) => {
				const { id, ...updateData } = input;
				const connection = await this.integrationsService.updateConnection(
					id,
					updateData as UpdateConnectionDto,
				);
				if (!connection) {
					throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
				}
				this.logger.log(`Updated integration connection: ${id}`);
				return this.serializeConnection(connection);
			}),

			// DELETE /integrations/connections/:id - Delete an integration connection
			deleteConnection: implement(
				integrationsContract.deleteConnection,
			).handler(async ({ input }) => {
				const deleted = await this.integrationsService.deleteConnection(
					input.id,
				);
				if (!deleted) {
					throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
				}
				this.logger.log(`Deleted integration connection: ${input.id}`);
			}),

			// POST /integrations/connections/:id/test - Test an integration connection
			testConnection: implement(integrationsContract.testConnection).handler(
				async ({ input }) => {
					const result = await this.integrationsService.testConnection(
						input.id,
					);
					return {
						success: result.success,
						message: result.success
							? "Connection test successful"
							: `Connection test failed: ${result.error}`,
					};
				},
			),

			// =========================================================================
			// GIT PROVIDER ENDPOINTS
			// =========================================================================

			// GET /integrations/connections/:id/git/organizations
			getGitOrganizations: implement(
				integrationsContract.getGitOrganizations,
			).handler(async ({ input }) => {
				return this.integrationsService.getGitOrganizations(input.id);
			}),

			// GET /integrations/connections/:id/git/repositories
			getGitRepositories: implement(
				integrationsContract.getGitRepositories,
			).handler(async ({ input }) => {
				return this.integrationsService.getGitRepositories(input.id, input.org);
			}),

			// PATCH /integrations/connections/:id/config
			updateConnectionConfig: implement(
				integrationsContract.updateConnectionConfig,
			).handler(async ({ input }) => {
				const connection = await this.integrationsService.updateConnectionConfig(
					input.id,
					input.config,
				);
				this.logger.log(`Updated config for connection: ${input.id}`);
				return this.serializeConnection(connection);
			}),

			// =========================================================================
			// SERVICE INTEGRATION ENDPOINTS
			// =========================================================================

			// GET /integrations/service/:serviceId
			getServiceIntegrations: implement(
				integrationsContract.getServiceIntegrations,
			).handler(async ({ input }) => {
				return this.integrationsService.getServiceIntegrationsWithStatus(
					input.serviceId,
				);
			}),

			// POST /integrations/service-integrations
			createServiceIntegration: implement(
				integrationsContract.createServiceIntegration,
			).handler(async ({ input }) => {
				const serviceIntegration =
					await this.integrationsService.createServiceIntegration(input);
				this.logger.log(
					`Created service integration: ${serviceIntegration.id}`,
				);
				return this.serializeServiceIntegration(serviceIntegration);
			}),

			// PATCH /integrations/service-integrations/:id
			updateServiceIntegration: implement(
				integrationsContract.updateServiceIntegration,
			).handler(async ({ input }) => {
				const { id, ...updateData } = input;
				const serviceIntegration =
					await this.integrationsService.updateServiceIntegrationById(
						id,
						updateData,
					);
				if (!serviceIntegration) {
					throw new ORPCError("NOT_FOUND", {
						message: "Service integration not found",
					});
				}
				this.logger.log(`Updated service integration: ${id}`);
				return this.serializeServiceIntegration(serviceIntegration);
			}),

			// DELETE /integrations/service-integrations/:id
			deleteServiceIntegration: implement(
				integrationsContract.deleteServiceIntegration,
			).handler(async ({ input }) => {
				const deleted =
					await this.integrationsService.deleteServiceIntegrationById(input.id);
				if (!deleted) {
					throw new ORPCError("NOT_FOUND", {
						message: "Service integration not found",
					});
				}
				this.logger.log(`Deleted service integration: ${input.id}`);
			}),
		};
	}

	private serializeDefinition(definition: any): any {
		return {
			...definition,
			capabilities: definition.capabilities
				? JSON.parse(definition.capabilities)
				: null,
			configSchema: definition.configSchema
				? JSON.parse(definition.configSchema)
				: null,
			createdAt: definition.createdAt?.toISOString(),
			updatedAt: definition.updatedAt?.toISOString(),
		};
	}

	private serializeConnection(connection: any): any {
		return {
			...connection,
			credentials: "[ENCRYPTED]", // Always mask credentials
			config: connection.config ? JSON.parse(connection.config) : null,
			createdAt: connection.createdAt?.toISOString(),
			updatedAt: connection.updatedAt?.toISOString(),
			lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
		};
	}

	private serializeConnectionWithDefinition(connection: any): any {
		const serialized = this.serializeConnection(connection);

		if (connection.definition) {
			serialized.definition = this.serializeDefinition(connection.definition);
		}

		return serialized;
	}

	private serializeServiceIntegration(serviceIntegration: any): any {
		return {
			...serviceIntegration,
			config: serviceIntegration.config
				? JSON.parse(serviceIntegration.config)
				: null,
			createdAt: serviceIntegration.createdAt?.toISOString(),
			updatedAt: serviceIntegration.updatedAt?.toISOString(),
		};
	}
}
