/**
 * Incident route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  IncidentSchema,
  IncidentWithRelationsSchema,
  CreateIncidentSchema,
  UpdateIncidentSchema,
  IncidentQuerySchema,
  AddAlertToIncidentSchema,
  InvestigateIncidentResponseSchema,
  IncidentStatsSchema,
  IdParamSchema,
  SuccessResponseSchema,
} from '../schemas/index.js'

export const incidentsContract = {
  /**
   * Create a new incident
   * POST /incidents
   */
  create: oc
    .route({
      method: 'POST',
      path: '/incidents',
      summary: 'Create a new incident',
      tags: ['incidents'],
    })
    .input(CreateIncidentSchema)
    .output(IncidentSchema),

  /**
   * List incidents with filtering
   * GET /incidents
   */
  list: oc
    .route({
      method: 'GET',
      path: '/incidents',
      summary: 'List incidents with optional filtering',
      tags: ['incidents'],
    })
    .input(IncidentQuerySchema)
    .output(z.array(IncidentWithRelationsSchema)),

  /**
   * Get active incidents
   * GET /incidents/active
   */
  listActive: oc
    .route({
      method: 'GET',
      path: '/incidents/active',
      summary: 'List active (non-resolved) incidents',
      tags: ['incidents'],
    })
    .input(z.object({}))
    .output(z.array(IncidentWithRelationsSchema)),

  /**
   * Get incident statistics
   * GET /incidents/stats
   */
  getStats: oc
    .route({
      method: 'GET',
      path: '/incidents/stats',
      summary: 'Get incident statistics',
      tags: ['incidents'],
    })
    .input(z.object({}))
    .output(IncidentStatsSchema),

  /**
   * Get a single incident by ID
   * GET /incidents/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/incidents/{id}',
      summary: 'Get incident by ID',
      tags: ['incidents'],
    })
    .input(IdParamSchema)
    .output(IncidentWithRelationsSchema),

  /**
   * Get an incident by number (INC-123)
   * GET /incidents/number/:number
   */
  getByNumber: oc
    .route({
      method: 'GET',
      path: '/incidents/number/{number}',
      summary: 'Get incident by number',
      tags: ['incidents'],
    })
    .input(z.object({ number: z.coerce.number().int() }))
    .output(IncidentWithRelationsSchema),

  /**
   * Update an incident
   * PATCH /incidents/:id
   */
  update: oc
    .route({
      method: 'PATCH',
      path: '/incidents/{id}',
      summary: 'Update incident',
      tags: ['incidents'],
    })
    .input(IdParamSchema.merge(UpdateIncidentSchema))
    .output(IncidentSchema),

  /**
   * Start investigation for an incident
   * POST /incidents/:id/investigate
   */
  investigate: oc
    .route({
      method: 'POST',
      path: '/incidents/{id}/investigate',
      summary: 'Start AI investigation for incident',
      tags: ['incidents'],
    })
    .input(IdParamSchema)
    .output(InvestigateIncidentResponseSchema),

  /**
   * Resolve an incident
   * POST /incidents/:id/resolve
   */
  resolve: oc
    .route({
      method: 'POST',
      path: '/incidents/{id}/resolve',
      summary: 'Resolve incident',
      tags: ['incidents'],
    })
    .input(IdParamSchema)
    .output(IncidentSchema),

  /**
   * Add an alert to an incident
   * POST /incidents/:id/alerts
   */
  addAlert: oc
    .route({
      method: 'POST',
      path: '/incidents/{id}/alerts',
      summary: 'Add alert to incident',
      tags: ['incidents'],
    })
    .input(IdParamSchema.merge(AddAlertToIncidentSchema))
    .output(SuccessResponseSchema),
}
