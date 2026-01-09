/**
 * @prismalens/contracts
 *
 * Shared API contracts and Zod schemas for PrismaLens.
 * Used by both the NestJS API and the Next.js frontend for end-to-end type safety.
 *
 * @example
 * ```typescript
 * // Import schemas for validation
 * import { AlertSchema, CreateAlertSchema } from '@prismalens/contracts/schemas'
 *
 * // Import contracts for oRPC
 * import { contract, alertsContract } from '@prismalens/contracts/contracts'
 *
 * // Or import everything from root
 * import { contract, AlertSchema } from '@prismalens/contracts'
 * ```
 */

// Export all schemas
export * from './schemas/index.js'

// Export all contracts
export * from './contracts/index.js'
