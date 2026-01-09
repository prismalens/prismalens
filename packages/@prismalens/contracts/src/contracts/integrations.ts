/**
 * Integration route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  IntegrationDefinitionSchema,
  IntegrationConnectionSchema,
  IntegrationConnectionWithDefinitionSchema,
  CreateConnectionSchema,
  UpdateConnectionSchema,
  IntegrationQuerySchema,
  OAuthStartResponseSchema,
  OAuthCallbackSchema,
  OAuthCallbackResponseSchema,
  IdParamSchema,
  SuccessResponseSchema,
} from '../schemas/index.js'

export const integrationsContract = {
  /**
   * List available integration definitions
   * GET /integrations/definitions
   */
  listDefinitions: oc
    .route({
      method: 'GET',
      path: '/integrations/definitions',
      summary: 'List available integration types',
      tags: ['integrations'],
    })
    .input(z.object({}))
    .output(z.array(IntegrationDefinitionSchema)),

  /**
   * Get a single integration definition
   * GET /integrations/definitions/:id
   */
  getDefinition: oc
    .route({
      method: 'GET',
      path: '/integrations/definitions/{id}',
      summary: 'Get integration definition by ID',
      tags: ['integrations'],
    })
    .input(IdParamSchema)
    .output(IntegrationDefinitionSchema),

  /**
   * Create a new integration connection
   * POST /integrations/connections
   */
  createConnection: oc
    .route({
      method: 'POST',
      path: '/integrations/connections',
      summary: 'Create a new integration connection',
      tags: ['integrations'],
    })
    .input(CreateConnectionSchema)
    .output(IntegrationConnectionSchema),

  /**
   * List integration connections
   * GET /integrations/connections
   */
  listConnections: oc
    .route({
      method: 'GET',
      path: '/integrations/connections',
      summary: 'List integration connections',
      tags: ['integrations'],
    })
    .input(IntegrationQuerySchema)
    .output(z.array(IntegrationConnectionWithDefinitionSchema)),

  /**
   * Get a single integration connection
   * GET /integrations/connections/:id
   */
  getConnection: oc
    .route({
      method: 'GET',
      path: '/integrations/connections/{id}',
      summary: 'Get integration connection by ID',
      tags: ['integrations'],
    })
    .input(IdParamSchema)
    .output(IntegrationConnectionWithDefinitionSchema),

  /**
   * Update an integration connection
   * PATCH /integrations/connections/:id
   */
  updateConnection: oc
    .route({
      method: 'PATCH',
      path: '/integrations/connections/{id}',
      summary: 'Update integration connection',
      tags: ['integrations'],
    })
    .input(IdParamSchema.merge(UpdateConnectionSchema))
    .output(IntegrationConnectionSchema),

  /**
   * Delete an integration connection
   * DELETE /integrations/connections/:id
   */
  deleteConnection: oc
    .route({
      method: 'DELETE',
      path: '/integrations/connections/{id}',
      summary: 'Delete integration connection',
      tags: ['integrations'],
    })
    .input(IdParamSchema)
    .output(z.void()),

  /**
   * Test an integration connection
   * POST /integrations/connections/:id/test
   */
  testConnection: oc
    .route({
      method: 'POST',
      path: '/integrations/connections/{id}/test',
      summary: 'Test integration connection health',
      tags: ['integrations'],
    })
    .input(IdParamSchema)
    .output(SuccessResponseSchema),
}

export const oauthContract = {
  /**
   * Start OAuth flow
   * GET /integrations/oauth/:definitionId/start
   */
  start: oc
    .route({
      method: 'GET',
      path: '/integrations/oauth/{definitionId}/start',
      summary: 'Start OAuth authentication flow',
      tags: ['oauth'],
    })
    .input(z.object({ definitionId: z.string().uuid() }))
    .output(OAuthStartResponseSchema),

  /**
   * Handle OAuth callback
   * GET /integrations/oauth/callback
   */
  callback: oc
    .route({
      method: 'GET',
      path: '/integrations/oauth/callback',
      summary: 'Handle OAuth callback',
      tags: ['oauth'],
    })
    .input(OAuthCallbackSchema)
    .output(OAuthCallbackResponseSchema),
}
