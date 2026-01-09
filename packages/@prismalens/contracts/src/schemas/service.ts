/**
 * Service catalog schemas
 */
import { z } from 'zod'
import {
  ServiceTypeSchema,
  ServiceTierSchema,
  DependencyTypeSchema,
  DependencyCriticalitySchema,
  DateStringSchema,
} from './common.js'

// =============================================================================
// SERVICE SCHEMAS
// =============================================================================

export const ServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  displayName: z.string().nullable(),
  description: z.string().nullable(),
  type: ServiceTypeSchema,
  tier: ServiceTierSchema,
  team: z.string().nullable(),
  slackChannel: z.string().nullable(),
  repository: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  metadata: z.record(z.unknown()).nullable(),
  discoverySource: z.string().nullable(),
  discoveryMetadata: z.record(z.unknown()).nullable(),
  isDiscovered: z.boolean(),
  isConfirmed: z.boolean(),
  createdAt: DateStringSchema,
  updatedAt: DateStringSchema,
})

export const CreateServiceSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  type: ServiceTypeSchema.optional(),
  tier: ServiceTierSchema.optional(),
  team: z.string().optional(),
  slackChannel: z.string().optional(),
  repository: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const UpdateServiceSchema = CreateServiceSchema.partial()

// =============================================================================
// SERVICE DEPENDENCY SCHEMAS
// =============================================================================

export const ServiceDependencySchema = z.object({
  id: z.string().uuid(),
  dependentId: z.string().uuid(),
  dependencyId: z.string().uuid(),
  dependencyType: DependencyTypeSchema,
  criticality: DependencyCriticalitySchema,
  createdAt: DateStringSchema,
})

export const AddDependencySchema = z.object({
  dependencyId: z.string().uuid(),
  dependencyType: DependencyTypeSchema.optional(),
  criticality: DependencyCriticalitySchema.optional(),
})

// =============================================================================
// SERVICE WITH RELATIONS
// =============================================================================

export const ServiceWithRelationsSchema = ServiceSchema.extend({
  dependencies: z.array(ServiceDependencySchema).optional(),
  dependents: z.array(ServiceDependencySchema).optional(),
  alertCount: z.number().int().optional(),
  incidentCount: z.number().int().optional(),
})

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Service = z.infer<typeof ServiceSchema>
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>
export type ServiceDependency = z.infer<typeof ServiceDependencySchema>
export type AddDependencyInput = z.infer<typeof AddDependencySchema>
export type ServiceWithRelations = z.infer<typeof ServiceWithRelationsSchema>
