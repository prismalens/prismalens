/**
 * Alert mapping rule schemas
 */
import { z } from 'zod'
import { DateStringSchema } from './common.js'

// =============================================================================
// ALERT MAPPING RULE SCHEMAS
// =============================================================================

export const AlertMappingRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  priority: z.number().int(), // Lower = higher priority
  enabled: z.boolean(),
  matchCriteria: z.record(z.unknown()), // JSON match criteria
  serviceId: z.string().uuid(),
  createdAt: DateStringSchema,
  updatedAt: DateStringSchema,
})

export const CreateMappingRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  matchCriteria: z.record(z.unknown()),
  serviceId: z.string().uuid(),
})

export const UpdateMappingRuleSchema = CreateMappingRuleSchema.partial()

// =============================================================================
// ALERT MAPPING WITH RELATIONS
// =============================================================================

const ServiceRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  displayName: z.string().nullable(),
})

export const AlertMappingRuleWithServiceSchema = AlertMappingRuleSchema.extend({
  service: ServiceRefSchema.optional(),
})

// =============================================================================
// TEST MAPPING SCHEMAS
// =============================================================================

export const TestMappingSchema = z.object({
  alertData: z.record(z.unknown()),
})

export const TestMappingResponseSchema = z.object({
  matchedRule: AlertMappingRuleSchema.nullable(),
  serviceId: z.string().uuid().nullable(),
  serviceName: z.string().nullable(),
})

// =============================================================================
// ALERT MAPPING QUERY SCHEMAS
// =============================================================================

export const AlertMappingQuerySchema = z.object({
  serviceId: z.string().uuid().optional(),
  enabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type AlertMappingRule = z.infer<typeof AlertMappingRuleSchema>
export type CreateMappingRuleInput = z.infer<typeof CreateMappingRuleSchema>
export type UpdateMappingRuleInput = z.infer<typeof UpdateMappingRuleSchema>
export type AlertMappingRuleWithService = z.infer<typeof AlertMappingRuleWithServiceSchema>
export type TestMappingInput = z.infer<typeof TestMappingSchema>
export type TestMappingResponse = z.infer<typeof TestMappingResponseSchema>
export type AlertMappingQuery = z.infer<typeof AlertMappingQuerySchema>
