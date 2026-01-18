/**
 * Integration route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	CreateConnectionSchema,
	CreateServiceIntegrationSchema,
	GitOrganizationSchema,
	GitRepositorySchema,
	IdParamSchema,
	IntegrationConnectionSchema,
	IntegrationConnectionWithDefinitionSchema,
	IntegrationDefinitionSchema,
	IntegrationQuerySchema,
	OAuthCallbackResponseSchema,
	OAuthCallbackSchema,
	OAuthStartResponseSchema,
	ServiceIntegrationSchema,
	ServiceIntegrationWithStatusSchema,
	SuccessResponseSchema,
	UpdateConnectionSchema,
	UpdateServiceIntegrationSchema,
} from "../schemas/index.js";

export const integrationsContract = {
	/**
	 * List available integration definitions
	 * GET /integrations/definitions
	 */
	listDefinitions: oc
		.route({
			method: "GET",
			path: "/integrations/definitions",
			summary: "List available integration types",
			tags: ["integrations"],
		})
		.input(z.object({}))
		.output(z.array(IntegrationDefinitionSchema)),

	/**
	 * Get a single integration definition
	 * GET /integrations/definitions/:id
	 */
	getDefinition: oc
		.route({
			method: "GET",
			path: "/integrations/definitions/{id}",
			summary: "Get integration definition by ID",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(IntegrationDefinitionSchema),

	/**
	 * Create a new integration connection
	 * POST /integrations/connections
	 */
	createConnection: oc
		.route({
			method: "POST",
			path: "/integrations/connections",
			summary: "Create a new integration connection",
			tags: ["integrations"],
		})
		.input(CreateConnectionSchema)
		.output(IntegrationConnectionSchema),

	/**
	 * List integration connections
	 * GET /integrations/connections
	 */
	listConnections: oc
		.route({
			method: "GET",
			path: "/integrations/connections",
			summary: "List integration connections",
			tags: ["integrations"],
		})
		.input(IntegrationQuerySchema)
		.output(z.array(IntegrationConnectionWithDefinitionSchema)),

	/**
	 * Get a single integration connection
	 * GET /integrations/connections/:id
	 */
	getConnection: oc
		.route({
			method: "GET",
			path: "/integrations/connections/{id}",
			summary: "Get integration connection by ID",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(IntegrationConnectionWithDefinitionSchema),

	/**
	 * Update an integration connection
	 * PATCH /integrations/connections/:id
	 */
	updateConnection: oc
		.route({
			method: "PATCH",
			path: "/integrations/connections/{id}",
			summary: "Update integration connection",
			tags: ["integrations"],
		})
		.input(IdParamSchema.merge(UpdateConnectionSchema))
		.output(IntegrationConnectionSchema),

	/**
	 * Delete an integration connection
	 * DELETE /integrations/connections/:id
	 */
	deleteConnection: oc
		.route({
			method: "DELETE",
			path: "/integrations/connections/{id}",
			summary: "Delete integration connection",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(z.void()),

	/**
	 * Test an integration connection
	 * POST /integrations/connections/:id/test
	 */
	testConnection: oc
		.route({
			method: "POST",
			path: "/integrations/connections/{id}/test",
			summary: "Test integration connection health",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(SuccessResponseSchema),

	// =========================================================================
	// GIT PROVIDER ENDPOINTS
	// =========================================================================

	/**
	 * Get organizations from a git provider connection
	 * GET /integrations/connections/:id/git/organizations
	 */
	getGitOrganizations: oc
		.route({
			method: "GET",
			path: "/integrations/connections/{id}/git/organizations",
			summary: "Get organizations from git provider",
			tags: ["integrations", "git"],
		})
		.input(IdParamSchema)
		.output(z.array(GitOrganizationSchema)),

	/**
	 * Get repositories from a git provider connection
	 * GET /integrations/connections/:id/git/repositories
	 */
	getGitRepositories: oc
		.route({
			method: "GET",
			path: "/integrations/connections/{id}/git/repositories",
			summary: "Get repositories from git provider",
			tags: ["integrations", "git"],
		})
		.input(
			IdParamSchema.extend({
				org: z.string().optional(),
			}),
		)
		.output(z.array(GitRepositorySchema)),

	/**
	 * Update connection config (e.g., selected repos after OAuth)
	 * PATCH /integrations/connections/:id/config
	 */
	updateConnectionConfig: oc
		.route({
			method: "PATCH",
			path: "/integrations/connections/{id}/config",
			summary: "Update connection configuration",
			tags: ["integrations"],
		})
		.input(
			IdParamSchema.extend({
				config: z.record(z.unknown()),
			}),
		)
		.output(IntegrationConnectionSchema),

	// =========================================================================
	// SERVICE INTEGRATION ENDPOINTS (Per-service overrides)
	// =========================================================================

	/**
	 * Get integrations for a service (with override status)
	 * GET /integrations/service/:serviceId
	 */
	getServiceIntegrations: oc
		.route({
			method: "GET",
			path: "/integrations/service/{serviceId}",
			summary: "Get integrations for a service with override status",
			tags: ["integrations", "services"],
		})
		.input(z.object({ serviceId: z.string().uuid() }))
		.output(z.array(ServiceIntegrationWithStatusSchema)),

	/**
	 * Create a service integration override
	 * POST /integrations/service-integrations
	 */
	createServiceIntegration: oc
		.route({
			method: "POST",
			path: "/integrations/service-integrations",
			summary: "Create per-service integration override",
			tags: ["integrations", "services"],
		})
		.input(CreateServiceIntegrationSchema)
		.output(ServiceIntegrationSchema),

	/**
	 * Update a service integration override
	 * PATCH /integrations/service-integrations/:id
	 */
	updateServiceIntegration: oc
		.route({
			method: "PATCH",
			path: "/integrations/service-integrations/{id}",
			summary: "Update per-service integration override",
			tags: ["integrations", "services"],
		})
		.input(IdParamSchema.merge(UpdateServiceIntegrationSchema))
		.output(ServiceIntegrationSchema),

	/**
	 * Delete a service integration override
	 * DELETE /integrations/service-integrations/:id
	 */
	deleteServiceIntegration: oc
		.route({
			method: "DELETE",
			path: "/integrations/service-integrations/{id}",
			summary: "Delete per-service integration override",
			tags: ["integrations", "services"],
		})
		.input(IdParamSchema)
		.output(z.void()),
};

export const oauthContract = {
	/**
	 * Start OAuth flow
	 * GET /integrations/oauth/:definitionId/start
	 */
	start: oc
		.route({
			method: "GET",
			path: "/integrations/oauth/{definitionId}/start",
			summary: "Start OAuth authentication flow",
			tags: ["oauth"],
		})
		.input(z.object({ definitionId: z.string().uuid() }))
		.output(OAuthStartResponseSchema),

	/**
	 * Handle OAuth callback
	 * GET /integrations/oauth/callback
	 */
	callback: oc
		.route({
			method: "GET",
			path: "/integrations/oauth/callback",
			summary: "Handle OAuth callback",
			tags: ["oauth"],
		})
		.input(OAuthCallbackSchema)
		.output(OAuthCallbackResponseSchema),
};
