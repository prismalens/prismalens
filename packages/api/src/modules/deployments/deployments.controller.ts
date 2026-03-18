import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { deploymentsContract } from '@prismalens/contracts';
import type { Deployment } from '@prismalens/contracts/schemas';
import type { Deployment as PrismaDeployment } from '@prismalens/database';
import { requireAdmin } from '../../core/auth/index.js';
import { DeploymentsService } from './deployments.service.js';

function serializeDeployment(dep: PrismaDeployment): Deployment {
  return {
    ...dep,
    createdAt: dep.createdAt.toISOString(),
    updatedAt: dep.updatedAt.toISOString(),
    lastDeployedAt: dep.lastDeployedAt?.toISOString() ?? null,
    metadata:
      typeof dep.metadata === 'string'
        ? (JSON.parse(dep.metadata) as Record<string, unknown>)
        : (dep.metadata as Record<string, unknown> | null),
  } as Deployment;
}

@Controller()
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Implement(deploymentsContract)
  deployments() {
    return {
      // POST /deployments/batch - Batch create deployments
      batchCreate: implement(deploymentsContract.batchCreate).handler(
        async ({ input, context }) => {
          requireAdmin(context);
          const result = await this.deploymentsService.batchCreate(input);
          return {
            created: result.created,
            deployments: result.deployments.map(serializeDeployment),
          };
        },
      ),

      // GET /deployments/unlinked-count - Count unlinked deployments
      unlinkedCount: implement(deploymentsContract.unlinkedCount).handler(
        async () => {
          const count = await this.deploymentsService.countUnlinked();
          return { count };
        },
      ),

      // GET /deployments - List all deployments
      list: implement(deploymentsContract.list).handler(async ({ input }) => {
        const { data, total } = await this.deploymentsService.findAll({
          connectionId: input.connectionId,
          serviceId: input.serviceId,
          search: input.search,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          data: data.map(serializeDeployment),
          total,
        };
      }),

      // GET /deployments/:id - Get deployment by ID
      get: implement(deploymentsContract.get).handler(async ({ input }) => {
        const deployment = await this.deploymentsService.findById(input.id);
        if (!deployment) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Deployment not found',
          });
        }
        return serializeDeployment(deployment);
      }),

      // POST /deployments/:id/link - Link deployment to service
      link: implement(deploymentsContract.link).handler(
        async ({ input, context }) => {
          requireAdmin(context);
          const { id, ...linkData } = input;
          const deployment = await this.deploymentsService.linkToService(
            id,
            linkData,
          );
          return serializeDeployment(deployment);
        },
      ),

      // DELETE /deployments/:id/unlink - Unlink deployment from service
      unlink: implement(deploymentsContract.unlink).handler(
        async ({ input, context }) => {
          requireAdmin(context);
          await this.deploymentsService.unlinkFromService(input.id);
        },
      ),

      // DELETE /deployments/:id - Delete an unlinked deployment
      delete: implement(deploymentsContract.delete).handler(
        async ({ input, context }) => {
          requireAdmin(context);
          await this.deploymentsService.delete(input.id);
        },
      ),
    };
  }
}
