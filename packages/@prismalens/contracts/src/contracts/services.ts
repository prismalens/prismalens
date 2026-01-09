/**
 * Service route contracts
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  ServiceSchema,
  ServiceWithRelationsSchema,
  CreateServiceSchema,
  UpdateServiceSchema,
  AddDependencySchema,
  ServiceDependencySchema,
  IdParamSchema,
  PaginationSchema,
} from '../schemas/index.js'

export const servicesContract = {
  /**
   * Create a new service
   * POST /services
   */
  create: oc
    .route({
      method: 'POST',
      path: '/services',
      summary: 'Create a new service',
      tags: ['services'],
    })
    .input(CreateServiceSchema)
    .output(ServiceSchema),

  /**
   * List all services
   * GET /services
   */
  list: oc
    .route({
      method: 'GET',
      path: '/services',
      summary: 'List all services',
      tags: ['services'],
    })
    .input(PaginationSchema)
    .output(z.array(ServiceWithRelationsSchema)),

  /**
   * Get a single service by ID
   * GET /services/:id
   */
  get: oc
    .route({
      method: 'GET',
      path: '/services/{id}',
      summary: 'Get service by ID',
      tags: ['services'],
    })
    .input(IdParamSchema)
    .output(ServiceWithRelationsSchema),

  /**
   * Update a service
   * PATCH /services/:id
   */
  update: oc
    .route({
      method: 'PATCH',
      path: '/services/{id}',
      summary: 'Update service',
      tags: ['services'],
    })
    .input(IdParamSchema.merge(UpdateServiceSchema))
    .output(ServiceSchema),

  /**
   * Delete a service
   * DELETE /services/:id
   */
  delete: oc
    .route({
      method: 'DELETE',
      path: '/services/{id}',
      summary: 'Delete service',
      tags: ['services'],
    })
    .input(IdParamSchema)
    .output(z.void()),

  /**
   * Add a dependency to a service
   * POST /services/:id/dependencies
   */
  addDependency: oc
    .route({
      method: 'POST',
      path: '/services/{id}/dependencies',
      summary: 'Add dependency to service',
      tags: ['services'],
    })
    .input(IdParamSchema.merge(AddDependencySchema))
    .output(ServiceDependencySchema),

  /**
   * Remove a dependency from a service
   * DELETE /services/:id/dependencies/:dependencyId
   */
  removeDependency: oc
    .route({
      method: 'DELETE',
      path: '/services/{id}/dependencies/{dependencyId}',
      summary: 'Remove dependency from service',
      tags: ['services'],
    })
    .input(
      z.object({
        id: z.string().uuid(),
        dependencyId: z.string().uuid(),
      })
    )
    .output(z.void()),

  /**
   * Get service topology (dependencies graph)
   * GET /services/:id/topology
   */
  getTopology: oc
    .route({
      method: 'GET',
      path: '/services/{id}/topology',
      summary: 'Get service dependency topology',
      tags: ['services'],
    })
    .input(IdParamSchema)
    .output(
      z.object({
        service: ServiceWithRelationsSchema,
        upstream: z.array(ServiceSchema),
        downstream: z.array(ServiceSchema),
      })
    ),
}
