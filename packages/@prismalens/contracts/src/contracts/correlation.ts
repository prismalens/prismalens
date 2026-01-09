/**
 * Correlation rule route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  CorrelationRuleSchema,
  CreateCorrelationRuleSchema,
  UpdateCorrelationRuleSchema,
  CorrelationRuleQuerySchema,
  TestCorrelationSchema,
  TestCorrelationResponseSchema,
  IdParamSchema,
} from '../schemas/index.js'

export const correlationContract = {
  /**
   * Create a new correlation rule
   * POST /correlation/rules
   */
  create: oc
    .route({
      method: 'POST',
      path: '/correlation/rules',
      summary: 'Create a new correlation rule',
      tags: ['correlation'],
    })
    .input(CreateCorrelationRuleSchema)
    .output(CorrelationRuleSchema),

  /**
   * List correlation rules
   * GET /correlation/rules
   */
  list: oc
    .route({
      method: 'GET',
      path: '/correlation/rules',
      summary: 'List correlation rules',
      tags: ['correlation'],
    })
    .input(CorrelationRuleQuerySchema)
    .output(z.array(CorrelationRuleSchema)),

  /**
   * Get a single correlation rule by ID
   * GET /correlation/rules/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/correlation/rules/{id}',
      summary: 'Get correlation rule by ID',
      tags: ['correlation'],
    })
    .input(IdParamSchema)
    .output(CorrelationRuleSchema),

  /**
   * Update a correlation rule
   * PATCH /correlation/rules/:id
   */
  update: oc
    .route({
      method: 'PATCH',
      path: '/correlation/rules/{id}',
      summary: 'Update correlation rule',
      tags: ['correlation'],
    })
    .input(IdParamSchema.merge(UpdateCorrelationRuleSchema))
    .output(CorrelationRuleSchema),

  /**
   * Delete a correlation rule
   * DELETE /correlation/rules/:id
   */
  delete: oc
    .route({
      method: 'DELETE',
      path: '/correlation/rules/{id}',
      summary: 'Delete correlation rule',
      tags: ['correlation'],
    })
    .input(IdParamSchema)
    .output(z.void()),

  /**
   * Test correlation rules against sample data
   * POST /correlation/test
   */
  test: oc
    .route({
      method: 'POST',
      path: '/correlation/test',
      summary: 'Test correlation rules against sample alert data',
      tags: ['correlation'],
    })
    .input(TestCorrelationSchema)
    .output(TestCorrelationResponseSchema),
}
