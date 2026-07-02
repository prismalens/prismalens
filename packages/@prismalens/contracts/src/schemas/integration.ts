/**
 * Integration schemas (three-layer: Template → Integration → Connection)
 */
import { z } from "zod";
import { ConnectionStatusSchema, DateStringSchema } from "./common.js";

// =============================================================================
// AUTH TEMPLATE RESPONSE SCHEMAS (from @prismalens/integrations templates)
// =============================================================================

export const TemplateFieldOptionSchema = z.object({
	label: z.string(),
	value: z.string(),
});

export const TemplateFieldSchema = z.object({
	name: z.string(),
	label: z.string(),
	type: z.enum([
		"string",
		"password",
		"select",
		"number",
		"boolean",
		"textarea",
	]),
	default: z.string().optional(),
	required: z.boolean().optional(),
	placeholder: z.string().optional(),
	description: z.string().optional(),
	example: z.string().optional(),
	pattern: z.string().optional(),
	options: z.array(TemplateFieldOptionSchema).optional(),
	sensitive: z.boolean().optional(),
	readonly: z.boolean().optional(),
	hidden: z.boolean().optional(),
});

export const AuthTemplateResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	version: z.string(),
	category: z.string(),
	authMode: z.enum(["api_key", "basic", "oauth2", "github_app"]),
	icon: z.string().optional(),
	docsUrl: z.string().optional(),
	setupDocsUrl: z.string().optional(),
	connectionFields: z.array(TemplateFieldSchema).optional(),
	integrationCredentialFields: z.array(TemplateFieldSchema).optional(),
	connectionCredentialFields: z.array(TemplateFieldSchema).optional(),
	hasOAuth: z.boolean(),
	authModeLabel: z.string(),
	connectionCreationMode: z.enum(["form", "oauth_redirect"]),
	postCreationAction: z.enum(["none", "oauth_redirect", "navigate"]),
	postCreationNavigateTo: z.string().optional(),
});

// =============================================================================
// INTEGRATION SCHEMAS (OAuth client creds)
// =============================================================================

export const IntegrationSchema = z.object({
	id: z.string().uuid(),
	templateId: z.string(),
	label: z.string(),
	scopes: z.array(z.string()),
	callbackUrl: z.string().nullable(),
	enabled: z.boolean(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateIntegrationSchema = z.object({
	templateId: z.string(),
	label: z.string().min(1),
	clientId: z.string().optional(),
	clientSecret: z.string().optional(),
	scopes: z.array(z.string()).optional(),
	callbackUrl: z.string().optional(),
});

export const UpdateIntegrationSchema = z.object({
	label: z.string().min(1).optional(),
	clientId: z.string().optional(),
	clientSecret: z.string().optional(),
	scopes: z.array(z.string()).optional(),
	callbackUrl: z.string().optional(),
	enabled: z.boolean().optional(),
});

// =============================================================================
// CONNECTION SCHEMAS (user tokens / API keys)
// =============================================================================

export const ConnectionSchema = z.object({
	id: z.string().uuid(),
	integrationId: z.string().uuid(),
	label: z.string(),
	userId: z.string(),
	status: ConnectionStatusSchema,
	tokenExpiresAt: DateStringSchema.nullable(),
	grantedScopes: z.array(z.string()),
	lastUsedAt: DateStringSchema.nullable(),
	lastRefreshedAt: DateStringSchema.nullable(),
	lastErrorMessage: z.string().nullable(),
	lastErrorAt: DateStringSchema.nullable(),
	consecutiveErrors: z.number().int(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const ConnectionWithIntegrationSchema = ConnectionSchema.extend({
	integration: IntegrationSchema.optional(),
	templateId: z.string().optional(),
	templateName: z.string().optional(),
	template: AuthTemplateResponseSchema.nullable().optional(),
});

export const CreateConnectionSchema = z.object({
	integrationId: z.string().uuid(),
	label: z.string().min(1),
	credentials: z.record(z.string(), z.string()),
	connectionConfig: z.record(z.string(), z.string()).optional(),
});

export const UpdateConnectionSchema = z.object({
	label: z.string().min(1).optional(),
	credentials: z.record(z.string(), z.string()).optional(),
	connectionConfig: z.record(z.string(), z.string()).optional(),
	status: ConnectionStatusSchema.optional(),
});

// =============================================================================
// OAUTH SCHEMAS
// =============================================================================

export const OAuthStartResponseSchema = z.object({
	redirectUrl: z.string().url(),
});

// =============================================================================
// INTEGRATION QUERY SCHEMAS
// =============================================================================

export const IntegrationQuerySchema = z.object({
	category: z.string().optional(),
	status: ConnectionStatusSchema.optional(),
	templateId: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// GIT PROVIDER SCHEMAS (from @prismalens/config — single source of truth)
// =============================================================================

export type {
	Capability,
	GitFileContent,
	GitOrganization,
	GitRepository,
	PermissionRequirement,
} from "@prismalens/config/integrations";
export {
	CapabilitySchema,
	GitFileContentSchema,
	GitOrganizationSchema,
	GitRepositorySchema,
	PermissionRequirementSchema,
} from "@prismalens/config/integrations";

// =============================================================================
// SERVICE INTEGRATION SCHEMAS (Per-service overrides)
// =============================================================================

export const ServiceIntegrationSchema = z.object({
	id: z.string().uuid(),
	serviceId: z.string().uuid(),
	connectionId: z.string().uuid(),
	priority: z.number().int().default(0),
	config: z.record(z.unknown()).nullable(),
	isEnabled: z.boolean().default(true),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateServiceIntegrationSchema = z.object({
	serviceId: z.string().uuid(),
	connectionId: z.string().uuid(),
	priority: z.number().int().optional(),
	config: z.record(z.unknown()).optional(),
	isEnabled: z.boolean().optional(),
});

export const UpdateServiceIntegrationSchema = z.object({
	priority: z.number().int().optional(),
	config: z.record(z.unknown()).optional(),
	isEnabled: z.boolean().optional(),
});

export const ServiceIntegrationWithStatusSchema = z.object({
	connectionId: z.string().uuid(),
	connectionName: z.string(),
	templateId: z.string(),
	templateName: z.string(),
	category: z.string(),
	status: ConnectionStatusSchema,
	isGlobal: z.boolean(),
	hasOverride: z.boolean(),
	overrideId: z.string().uuid().optional(),
	globalConfig: z.record(z.unknown()).nullable(),
	serviceConfig: z.record(z.unknown()).nullable(),
	effectiveConfig: z.record(z.unknown()).nullable(),
});

// =============================================================================
// GITHUB APP SCHEMAS
// =============================================================================

export const GitHubInstallationSchema = z.object({
	id: z.number(),
	account: z.object({
		login: z.string(),
		id: z.number(),
		type: z.string(),
		avatarUrl: z.string().optional(),
	}),
	appId: z.number(),
	targetType: z.string(),
	permissions: z.record(z.string()),
	events: z.array(z.string()),
	repositorySelection: z.string(),
});

export const ConnectInstallationSchema = z.object({
	installationId: z.string(),
	organization: z.string().optional(),
	permissionOverrides: z.record(z.string()).optional(),
});

// =============================================================================
// DELETION IMPACT SCHEMAS
// =============================================================================

export const DeletionImpactSchema = z.object({
	connections: z.array(
		z.object({
			id: z.string().uuid(),
			label: z.string(),
		}),
	),
	repositories: z.array(
		z.object({
			id: z.string().uuid(),
			fullName: z.string(),
		}),
	),
	deployments: z.array(
		z.object({
			id: z.string().uuid(),
			name: z.string(),
		}),
	),
	affectedServices: z.array(
		z.object({
			id: z.string().uuid(),
			name: z.string(),
			impact: z.enum([
				"repo_link_lost",
				"deployment_link_lost",
				"integration_override_lost",
			]),
		}),
	),
	suggestionsCount: z.number().int(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type AuthTemplateResponse = z.infer<typeof AuthTemplateResponseSchema>;
export type TemplateField = z.infer<typeof TemplateFieldSchema>;
export type Integration = z.infer<typeof IntegrationSchema>;
export type CreateIntegrationInput = z.infer<typeof CreateIntegrationSchema>;
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type ConnectionWithIntegration = z.infer<
	typeof ConnectionWithIntegrationSchema
>;
export type CreateConnectionInput = z.infer<typeof CreateConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof UpdateConnectionSchema>;
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;
export type IntegrationQuery = z.infer<typeof IntegrationQuerySchema>;

// Git provider types — re-exported from @prismalens/config/integrations above

// Service integration types
export type ServiceIntegration = z.infer<typeof ServiceIntegrationSchema>;
export type CreateServiceIntegrationInput = z.infer<
	typeof CreateServiceIntegrationSchema
>;
export type UpdateServiceIntegrationInput = z.infer<
	typeof UpdateServiceIntegrationSchema
>;
export type ServiceIntegrationWithStatus = z.infer<
	typeof ServiceIntegrationWithStatusSchema
>;

// GitHub App types
export type GitHubInstallation = z.infer<typeof GitHubInstallationSchema>;
export type ConnectInstallationInput = z.infer<
	typeof ConnectInstallationSchema
>;

// Deletion impact types
export type DeletionImpact = z.infer<typeof DeletionImpactSchema>;
