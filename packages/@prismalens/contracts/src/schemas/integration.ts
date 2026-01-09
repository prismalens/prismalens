/**
 * Integration schemas (external tool connections)
 */
import { z } from 'zod'
import { ConnectionStatusSchema, AuthMethodSchema, DateStringSchema } from './common.js'

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
  iconUrl: z.string().nullable(),
  docsUrl: z.string().nullable(),
  maxConnectionsCE: z.number().int().nullable(),
  isEnabled: z.boolean(),
  createdAt: DateStringSchema,
  updatedAt: DateStringSchema,
})

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
})

export const CreateConnectionSchema = z.object({
  definitionId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  authMethod: AuthMethodSchema,
  credentials: z.object({
    apiKey: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
  }),
  config: z.record(z.unknown()).optional(),
})

export const UpdateConnectionSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  credentials: z
    .object({
      apiKey: z.string().optional(),
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
    })
    .optional(),
  config: z.record(z.unknown()).optional(),
})

// =============================================================================
// INTEGRATION CONNECTION WITH RELATIONS
// =============================================================================

export const IntegrationConnectionWithDefinitionSchema = IntegrationConnectionSchema.extend({
  definition: IntegrationDefinitionSchema.optional(),
})

// =============================================================================
// OAUTH SCHEMAS
// =============================================================================

export const OAuthStartResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string(),
})

export const OAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
})

export const OAuthCallbackResponseSchema = z.object({
  connectionId: z.string().uuid(),
  status: ConnectionStatusSchema,
})

// =============================================================================
// INTEGRATION QUERY SCHEMAS
// =============================================================================

export const IntegrationQuerySchema = z.object({
  category: z.string().optional(),
  status: ConnectionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type IntegrationDefinition = z.infer<typeof IntegrationDefinitionSchema>
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>
export type CreateConnectionInput = z.infer<typeof CreateConnectionSchema>
export type UpdateConnectionInput = z.infer<typeof UpdateConnectionSchema>
export type IntegrationConnectionWithDefinition = z.infer<
  typeof IntegrationConnectionWithDefinitionSchema
>
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>
export type OAuthCallbackInput = z.infer<typeof OAuthCallbackSchema>
export type OAuthCallbackResponse = z.infer<typeof OAuthCallbackResponseSchema>
export type IntegrationQuery = z.infer<typeof IntegrationQuerySchema>
