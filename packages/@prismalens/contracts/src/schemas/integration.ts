/**
 * Integration schemas (external tool connections)
 */
import { z } from "zod";
import {
	AuthMethodSchema,
	ConnectionStatusSchema,
	DateStringSchema,
} from "./common.js";

// =============================================================================
// INTEGRATION DEFINITION SCHEMAS
// =============================================================================

export const IntegrationDefinitionSchema = z.object({
	id: z.string().uuid(),
	name: z.string(), // github, prometheus, slack
	displayName: z.string(),
	description: z.string().nullable(),
	category: z.string(), // monitoring, code_source, knowledge_base
	authType: z.string(), // api_key, oauth2, both
	configSchema: z.record(z.unknown()).nullable(),
	credentialSchema: z.record(z.unknown()).nullable().optional(),
	iconUrl: z.string().nullable(),
	docsUrl: z.string().nullable(),
	maxConnectionsCE: z.number().int().nullable(),
	isEnabled: z.boolean(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

// =============================================================================
// INTEGRATION CONNECTION SCHEMAS
// =============================================================================

export const IntegrationConnectionSchema = z.object({
	id: z.string().uuid(),
	definitionId: z.string().uuid(),
	name: z.string().min(1),
	description: z.string().nullable(),
	isGlobal: z.boolean(),
	status: ConnectionStatusSchema,
	lastHealthCheck: DateStringSchema.nullable(),
	lastError: z.string().nullable(),
	authMethod: AuthMethodSchema,
	// credentials are encrypted and never returned to client
	config: z.record(z.unknown()).nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateConnectionSchema = z.object({
	definitionId: z.string().uuid(),
	name: z.string().min(1),
	description: z.string().optional(),
	authMethod: AuthMethodSchema,
	credentials: z.record(z.string(), z.string()),
	config: z.record(z.unknown()).optional(),
});

export const UpdateConnectionSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	credentials: z.record(z.string(), z.string()).optional(),
	config: z.record(z.unknown()).optional(),
});

// =============================================================================
// INTEGRATION CONNECTION WITH RELATIONS
// =============================================================================

export const IntegrationConnectionWithDefinitionSchema =
	IntegrationConnectionSchema.extend({
		definition: IntegrationDefinitionSchema.optional(),
	});

// =============================================================================
// OAUTH SCHEMAS
// =============================================================================

export const OAuthStartResponseSchema = z.object({
	authUrl: z.string().url(),
	state: z.string(),
});

export const OAuthCallbackSchema = z.object({
	code: z.string(),
	state: z.string(),
});

export const OAuthCallbackResponseSchema = z.object({
	connectionId: z.string().uuid(),
	status: ConnectionStatusSchema,
});

// =============================================================================
// INTEGRATION QUERY SCHEMAS
// =============================================================================

export const IntegrationQuerySchema = z.object({
	category: z.string().optional(),
	status: ConnectionStatusSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// GIT PROVIDER SCHEMAS (GitHub, GitLab, BitBucket)
// =============================================================================

export const GitOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(), // Login/slug (e.g., "prismalens-org")
	displayName: z.string(),
	avatarUrl: z.string().optional(),
	repoCount: z.number().int().optional(),
	description: z.string().optional(),
});

export const GitRepositorySchema = z.object({
	id: z.string(),
	name: z.string(), // Repo name only (e.g., "api")
	fullName: z.string(), // Full name with org (e.g., "prismalens-org/api")
	description: z.string().optional(),
	language: z.string().optional(),
	stars: z.number().int().optional(),
	defaultBranch: z.string(),
	isPrivate: z.boolean(),
	url: z.string(), // Web URL
	cloneUrl: z.string().optional(),
	updatedAt: z.string().optional(),
});

// =============================================================================
// SERVICE INTEGRATION SCHEMAS (Per-service overrides)
// =============================================================================

export const ServiceIntegrationSchema = z.object({
	id: z.string().uuid(),
	serviceId: z.string().uuid(),
	connectionId: z.string().uuid(),
	priority: z.number().int().default(0),
	config: z.record(z.unknown()).nullable(), // Service-specific config overrides
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

/**
 * Service integration with computed override status
 * Used when listing integrations for a service
 */
export const ServiceIntegrationWithStatusSchema = z.object({
	connectionId: z.string().uuid(),
	connectionName: z.string(),
	definitionName: z.string(), // github, prometheus, etc.
	definitionDisplayName: z.string(),
	category: z.string(),
	status: ConnectionStatusSchema,
	isGlobal: z.boolean(), // true = inherited from global, false = service-specific
	hasOverride: z.boolean(), // true = has service-specific override
	overrideId: z.string().uuid().optional(), // ServiceIntegration.id if has override
	globalConfig: z.record(z.unknown()).nullable(), // Global connection config
	serviceConfig: z.record(z.unknown()).nullable(), // Service-specific override config
	effectiveConfig: z.record(z.unknown()).nullable(), // Merged config (serviceConfig || globalConfig)
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type IntegrationDefinition = z.infer<typeof IntegrationDefinitionSchema>;
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type CreateConnectionInput = z.infer<typeof CreateConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof UpdateConnectionSchema>;
export type IntegrationConnectionWithDefinition = z.infer<
	typeof IntegrationConnectionWithDefinitionSchema
>;
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;
export type OAuthCallbackInput = z.infer<typeof OAuthCallbackSchema>;
export type OAuthCallbackResponse = z.infer<typeof OAuthCallbackResponseSchema>;
export type IntegrationQuery = z.infer<typeof IntegrationQuerySchema>;

// Git provider types
export type GitOrganization = z.infer<typeof GitOrganizationSchema>;
export type GitRepository = z.infer<typeof GitRepositorySchema>;

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
