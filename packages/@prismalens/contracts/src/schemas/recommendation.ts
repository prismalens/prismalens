/**
 * Recommendation schemas
 */
import { z } from 'zod'
import {
  RecommendationPrioritySchema,
  RecommendationCategorySchema,
  UrgencySchema,
  EffortEstimateSchema,
  RecommendationStatusSchema,
  DateStringSchema,
} from './common.js'

// =============================================================================
// RECOMMENDATION SCHEMAS
// =============================================================================

export const RecommendationSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable(),
  priority: RecommendationPrioritySchema,
  category: RecommendationCategorySchema.nullable(),
  urgency: UrgencySchema.nullable(),
  actionable: z.boolean(),
  estimatedEffort: EffortEstimateSchema.nullable(),
  status: RecommendationStatusSchema,
  implementedAt: DateStringSchema.nullable(),
  implementedBy: z.string().nullable(),
  createdAt: DateStringSchema,
  updatedAt: DateStringSchema,
})

export const UpdateRecommendationSchema = z.object({
  status: RecommendationStatusSchema.optional(),
  priority: RecommendationPrioritySchema.optional(),
})

// =============================================================================
// RECOMMENDATION WITH RELATIONS
// =============================================================================

// Investigation reference (minimal)
const InvestigationRefSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  status: z.string(),
})

export const RecommendationWithRelationsSchema = RecommendationSchema.extend({
  investigation: InvestigationRefSchema.optional(),
})

// =============================================================================
// RECOMMENDATION QUERY SCHEMAS
// =============================================================================

export const RecommendationQuerySchema = z.object({
  investigationId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  status: RecommendationStatusSchema.optional(),
  priority: RecommendationPrioritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// =============================================================================
// RECOMMENDATION STATS
// =============================================================================

export const RecommendationStatsSchema = z.object({
  total: z.number().int(),
  byStatus: z.record(z.number().int()),
  byPriority: z.record(z.number().int()),
  byCategory: z.record(z.number().int()),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Recommendation = z.infer<typeof RecommendationSchema>
export type UpdateRecommendationInput = z.infer<typeof UpdateRecommendationSchema>
export type RecommendationWithRelations = z.infer<typeof RecommendationWithRelationsSchema>
export type RecommendationQuery = z.infer<typeof RecommendationQuerySchema>
export type RecommendationStats = z.infer<typeof RecommendationStatsSchema>
