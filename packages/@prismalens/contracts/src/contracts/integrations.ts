/**
 * Integration route contracts
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AuthTemplateResponseSchema,
	ConnectInstallationSchema,
	ConnectionSchema,
	ConnectionWithIntegrationSchema,
	CreateConnectionSchema,
	CreateIntegrationSchema,
	CreateServiceIntegrationSchema,
	GitHubInstallationSchema,
	GitOrganizationSchema,
	GitRepositorySchema,
	IdParamSchema,
	IntegrationQuerySchema,
	IntegrationSchema,
	OAuthStartResponseSchema,
	ServiceIntegrationSchema,
	ServiceIntegrationWithStatusSchema,
	SuccessResponseSchema,
	UpdateConnectionSchema,
	UpdateIntegrationSchema,
	UpdateServiceIntegrationSchema,
} from "../schemas/index.js";

export const integrationsContract = {
	// =========================================================================
	// TEMPLATES (from @prismalens/integrations package)
	// =========================================================================

	listTemplates: oc
		.route({
			method: "GET",
			path: "/integrations/templates",
			summary: "List available integration templates",
			tags: ["integrations"],
		})
		.input(z.object({}))
		.output(z.array(AuthTemplateResponseSchema)),

	getTemplate: oc
		.route({
			method: "GET",
			path: "/integrations/templates/{id}",
			summary: "Get integration template by ID",
			tags: ["integrations"],
		})
		.input(z.object({ id: z.string() }))
		.output(AuthTemplateResponseSchema),

	// =========================================================================
	// INTEGRATIONS — static paths first to avoid {id} param collision
	// =========================================================================

	createIntegration: oc
		.route({
			method: "POST",
			path: "/integrations",
			summary: "Create a new integration",
			tags: ["integrations"],
		})
		.input(CreateIntegrationSchema)
		.output(IntegrationSchema),

	listIntegrations: oc
		.route({
			method: "GET",
			path: "/integrations",
			summary: "List integrations",
			tags: ["integrations"],
		})
		.input(IntegrationQuerySchema)
		.output(z.array(IntegrationSchema)),

	// =========================================================================
	// CONNECTIONS (user tokens / API keys)
	// Must be defined before /integrations/{id} to avoid route collision
	// =========================================================================

	createConnection: oc
		.route({
			method: "POST",
			path: "/integrations/connections",
			summary: "Create a new connection",
			tags: ["integrations"],
		})
		.input(CreateConnectionSchema)
		.output(ConnectionSchema),

	listConnections: oc
		.route({
			method: "GET",
			path: "/integrations/connections",
			summary: "List connections",
			tags: ["integrations"],
		})
		.input(IntegrationQuerySchema)
		.output(z.array(ConnectionWithIntegrationSchema)),

	getConnection: oc
		.route({
			method: "GET",
			path: "/integrations/connections/{id}",
			summary: "Get connection by ID",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(ConnectionWithIntegrationSchema),

	updateConnection: oc
		.route({
			method: "PATCH",
			path: "/integrations/connections/{id}",
			summary: "Update connection",
			tags: ["integrations"],
		})
		.input(IdParamSchema.merge(UpdateConnectionSchema))
		.output(ConnectionSchema),

	deleteConnection: oc
		.route({
			method: "DELETE",
			path: "/integrations/connections/{id}",
			summary: "Delete connection",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(z.void()),

	testConnection: oc
		.route({
			method: "POST",
			path: "/integrations/connections/{id}/test",
			summary: "Test connection health",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(SuccessResponseSchema),

	// =========================================================================
	// GIT PROVIDER ENDPOINTS
	// =========================================================================

	getGitOrganizations: oc
		.route({
			method: "GET",
			path: "/integrations/connections/{id}/git/organizations",
			summary: "Get organizations from git provider",
			tags: ["integrations", "git"],
		})
		.input(IdParamSchema)
		.output(z.array(GitOrganizationSchema)),

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
		.output(ConnectionSchema),

	// =========================================================================
	// GITHUB APP ENDPOINTS
	// =========================================================================

	listGitHubInstallations: oc
		.route({
			method: "GET",
			path: "/integrations/{id}/github/installations",
			summary: "List available GitHub App installations",
			tags: ["integrations", "github"],
		})
		.input(IdParamSchema)
		.output(z.array(GitHubInstallationSchema)),

	connectGitHubInstallation: oc
		.route({
			method: "POST",
			path: "/integrations/{id}/github/installations/connect",
			summary: "Create connection for a GitHub App installation",
			tags: ["integrations", "github"],
		})
		.input(IdParamSchema.merge(ConnectInstallationSchema))
		.output(ConnectionSchema),

	// =========================================================================
	// SERVICE INTEGRATION ENDPOINTS (Per-service overrides)
	// Must be defined before /integrations/{id} to avoid route collision
	// =========================================================================

	getServiceIntegrations: oc
		.route({
			method: "GET",
			path: "/integrations/service/{serviceId}",
			summary: "Get integrations for a service with override status",
			tags: ["integrations", "services"],
		})
		.input(z.object({ serviceId: z.string().uuid() }))
		.output(z.array(ServiceIntegrationWithStatusSchema)),

	createServiceIntegration: oc
		.route({
			method: "POST",
			path: "/integrations/service-integrations",
			summary: "Create per-service integration override",
			tags: ["integrations", "services"],
		})
		.input(CreateServiceIntegrationSchema)
		.output(ServiceIntegrationSchema),

	updateServiceIntegration: oc
		.route({
			method: "PATCH",
			path: "/integrations/service-integrations/{id}",
			summary: "Update per-service integration override",
			tags: ["integrations", "services"],
		})
		.input(IdParamSchema.merge(UpdateServiceIntegrationSchema))
		.output(ServiceIntegrationSchema),

	deleteServiceIntegration: oc
		.route({
			method: "DELETE",
			path: "/integrations/service-integrations/{id}",
			summary: "Delete per-service integration override",
			tags: ["integrations", "services"],
		})
		.input(IdParamSchema)
		.output(z.void()),

	// =========================================================================
	// INTEGRATION by ID (parameterized — must be LAST to avoid collisions)
	// =========================================================================

	getIntegration: oc
		.route({
			method: "GET",
			path: "/integrations/{id}",
			summary: "Get integration by ID",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(IntegrationSchema),

	updateIntegration: oc
		.route({
			method: "PATCH",
			path: "/integrations/{id}",
			summary: "Update integration",
			tags: ["integrations"],
		})
		.input(IdParamSchema.merge(UpdateIntegrationSchema))
		.output(IntegrationSchema),

	deleteIntegration: oc
		.route({
			method: "DELETE",
			path: "/integrations/{id}",
			summary: "Delete integration",
			tags: ["integrations"],
		})
		.input(IdParamSchema)
		.output(z.void()),
};

export const oauthContract = {
	start: oc
		.route({
			method: "POST",
			path: "/integrations/oauth/{integrationId}/authorize",
			summary: "Start OAuth authorization flow",
			tags: ["oauth"],
		})
		.input(z.object({ integrationId: z.string().uuid() }))
		.output(OAuthStartResponseSchema),

	callback: oc
		.route({
			method: "GET",
			path: "/integrations/oauth/callback",
			summary: "Handle OAuth callback",
			tags: ["oauth"],
		})
		.input(z.object({
			code: z.string().optional(),
			state: z.string().optional(),
			error: z.string().optional(),
			error_description: z.string().optional(),
		}))
		.output(z.void()),
};
