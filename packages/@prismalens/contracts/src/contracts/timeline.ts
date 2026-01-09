/**
 * Timeline route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  TimelineEntrySchema,
  TimelineEntryWithRelationsSchema,
  CreateTimelineEntrySchema,
  TimelineQuerySchema,
  IdParamSchema,
} from '../schemas/index.js'

export const timelineContract = {
  /**
   * Create a new timeline entry
   * POST /timeline
   */
  create: oc
    .route({
      method: 'POST',
      path: '/timeline',
      summary: 'Create a new timeline entry',
      tags: ['timeline'],
    })
    .input(CreateTimelineEntrySchema)
    .output(TimelineEntrySchema),

  /**
   * List timeline entries for an incident
   * GET /timeline
   */
  list: oc
    .route({
      method: 'GET',
      path: '/timeline',
      summary: 'List timeline entries for an incident',
      tags: ['timeline'],
    })
    .input(TimelineQuerySchema)
    .output(z.array(TimelineEntryWithRelationsSchema)),

  /**
   * Get a single timeline entry by ID
   * GET /timeline/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/timeline/{id}',
      summary: 'Get timeline entry by ID',
      tags: ['timeline'],
    })
    .input(IdParamSchema)
    .output(TimelineEntryWithRelationsSchema),

  /**
   * Delete a timeline entry
   * DELETE /timeline/:id
   */
  delete: oc
    .route({
      method: 'DELETE',
      path: '/timeline/{id}',
      summary: 'Delete timeline entry',
      tags: ['timeline'],
    })
    .input(IdParamSchema)
    .output(z.void()),
}
