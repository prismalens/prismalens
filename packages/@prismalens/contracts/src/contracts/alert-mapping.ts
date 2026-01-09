/**
 * Alert mapping rule route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  AlertMappingRuleSchema,
  AlertMappingRuleWithServiceSchema,
  CreateMappingRuleSchema,
  UpdateMappingRuleSchema,
  AlertMappingQuerySchema,
  TestMappingSchema,
  TestMappingResponseSchema,
  IdParamSchema,
} from '../schemas/index.js'

export const alertMappingContract = {
  /**
   * Create a new alert mapping rule
   * POST /alert-mapping/rules
   */
  create: oc
    .route({
      method: 'POST',
      path: '/alert-mapping/rules',
      summary: 'Create a new alert mapping rule',
      tags: ['alert-mapping'],
    })
    .input(CreateMappingRuleSchema)
    .output(AlertMappingRuleSchema),

  /**
   * List alert mapping rules
   * GET /alert-mapping/rules
   */
  list: oc
    .route({
      method: 'GET',
      path: '/alert-mapping/rules',
      summary: 'List alert mapping rules',
      tags: ['alert-mapping'],
    })
    .input(AlertMappingQuerySchema)
    .output(z.array(AlertMappingRuleWithServiceSchema)),

  /**
   * Get a single alert mapping rule by ID
   * GET /alert-mapping/rules/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/alert-mapping/rules/{id}',
      summary: 'Get alert mapping rule by ID',
      tags: ['alert-mapping'],
    })
    .input(IdParamSchema)
    .output(AlertMappingRuleWithServiceSchema),

  /**
   * Update an alert mapping rule
   * PATCH /alert-mapping/rules/:id
   */
  update: oc
    .route({
      method: 'PATCH',
      path: '/alert-mapping/rules/{id}',
      summary: 'Update alert mapping rule',
      tags: ['alert-mapping'],
    })
    .input(IdParamSchema.merge(UpdateMappingRuleSchema))
    .output(AlertMappingRuleSchema),

  /**
   * Delete an alert mapping rule
   * DELETE /alert-mapping/rules/:id
   */
  delete: oc
    .route({
      method: 'DELETE',
      path: '/alert-mapping/rules/{id}',
      summary: 'Delete alert mapping rule',
      tags: ['alert-mapping'],
    })
    .input(IdParamSchema)
    .output(z.void()),

  /**
   * Test mapping rules against sample data
   * POST /alert-mapping/test
   */
  test: oc
    .route({
      method: 'POST',
      path: '/alert-mapping/test',
      summary: 'Test mapping rules against sample alert data',
      tags: ['alert-mapping'],
    })
    .input(TestMappingSchema)
    .output(TestMappingResponseSchema),
}
