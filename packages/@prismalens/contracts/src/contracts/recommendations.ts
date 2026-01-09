/**
 * Recommendation route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  RecommendationSchema,
  RecommendationWithRelationsSchema,
  UpdateRecommendationSchema,
  RecommendationQuerySchema,
  RecommendationStatsSchema,
  IdParamSchema,
} from '../schemas/index.js'

export const recommendationsContract = {
  /**
   * List recommendations with filtering
   * GET /recommendations
   */
  list: oc
    .route({
      method: 'GET',
      path: '/recommendations',
      summary: 'List recommendations with optional filtering',
      tags: ['recommendations'],
    })
    .input(RecommendationQuerySchema)
    .output(z.array(RecommendationWithRelationsSchema)),

  /**
   * Get recommendation statistics
   * GET /recommendations/stats
   */
  getStats: oc
    .route({
      method: 'GET',
      path: '/recommendations/stats',
      summary: 'Get recommendation statistics',
      tags: ['recommendations'],
    })
    .input(z.object({}))
    .output(RecommendationStatsSchema),

  /**
   * Get a single recommendation by ID
   * GET /recommendations/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/recommendations/{id}',
      summary: 'Get recommendation by ID',
      tags: ['recommendations'],
    })
    .input(IdParamSchema)
    .output(RecommendationWithRelationsSchema),

  /**
   * Update a recommendation (status, priority)
   * PATCH /recommendations/:id
   */
  update: oc
    .route({
      method: 'PATCH',
      path: '/recommendations/{id}',
      summary: 'Update recommendation status or priority',
      tags: ['recommendations'],
    })
    .input(IdParamSchema.merge(UpdateRecommendationSchema))
    .output(RecommendationSchema),

  /**
   * Complete a recommendation
   * POST /recommendations/:id/complete
   */
  complete: oc
    .route({
      method: 'POST',
      path: '/recommendations/{id}/complete',
      summary: 'Mark recommendation as completed',
      tags: ['recommendations'],
    })
    .input(IdParamSchema)
    .output(RecommendationSchema),

  /**
   * Dismiss a recommendation
   * POST /recommendations/:id/dismiss
   */
  dismiss: oc
    .route({
      method: 'POST',
      path: '/recommendations/{id}/dismiss',
      summary: 'Dismiss/reject recommendation',
      tags: ['recommendations'],
    })
    .input(IdParamSchema)
    .output(RecommendationSchema),
}
