/**
 * Event route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import { EventSchema, CreateEventSchema, EventQuerySchema, IdParamSchema } from '../schemas/index.js'

export const eventsContract = {
  /**
   * Create a new event
   * POST /events
   */
  create: oc
    .route({
      method: 'POST',
      path: '/events',
      summary: 'Create a new event',
      tags: ['events'],
    })
    .input(CreateEventSchema)
    .output(EventSchema),

  /**
   * List events with filtering
   * GET /events
   */
  list: oc
    .route({
      method: 'GET',
      path: '/events',
      summary: 'List events with optional filtering',
      tags: ['events'],
    })
    .input(EventQuerySchema)
    .output(z.array(EventSchema)),

  /**
   * Get a single event by ID
   * GET /events/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/events/{id}',
      summary: 'Get event by ID',
      tags: ['events'],
    })
    .input(IdParamSchema)
    .output(EventSchema),
}
