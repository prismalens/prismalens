import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { repositoriesContract } from '@prismalens/contracts';
import type {
  Repository,
  RepositoryWithServices,
  ServiceRepository,
} from '@prismalens/contracts/schemas';
import type { Repository as PrismaRepository } from '@prismalens/database';
import { RepositoriesService } from './repositories.service.js';

function serializeRepository(repo: PrismaRepository): Repository {
  return {
    ...repo,
    createdAt: repo.createdAt.toISOString(),
    updatedAt: repo.updatedAt.toISOString(),
    metadata:
      typeof repo.metadata === 'string'
        ? (JSON.parse(repo.metadata) as Record<string, unknown>)
        : (repo.metadata as Record<string, unknown> | null),
  } as Repository;
}

function serializeRepositoryWithServices(
  repo: PrismaRepository & {
    services?: Array<{ createdAt: Date; [key: string]: unknown }>;
  },
): RepositoryWithServices {
  return {
    ...serializeRepository(repo),
    services: repo.services?.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })) as ServiceRepository[] | undefined,
  } as RepositoryWithServices;
}

@Controller()
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Implement(repositoriesContract)
  repositories() {
    return {
      // POST /repositories/batch - Batch create repositories
      batchCreate: implement(repositoriesContract.batchCreate).handler(
        async ({ input }) => {
          const result = await this.repositoriesService.batchCreate(input);
          return {
            created: result.created,
            repositories: result.repositories.map(serializeRepository),
          };
        },
      ),

      // GET /repositories - List all repositories
      list: implement(repositoriesContract.list).handler(async ({ input }) => {
        const { data, total } = await this.repositoriesService.findAll({
          connectionId: input.connectionId,
          search: input.search,
          limit: input.limit,
          offset: input.offset,
        });
        return {
          data: data.map(serializeRepositoryWithServices),
          total,
        };
      }),

      // GET /repositories/:id - Get repository by ID
      get: implement(repositoriesContract.get).handler(async ({ input }) => {
        const repo = await this.repositoriesService.findById(input.id);
        if (!repo) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Repository not found',
          });
        }
        return serializeRepositoryWithServices(repo);
      }),

      // POST /repositories/:id/link - Link repository to service
      link: implement(repositoriesContract.link).handler(async ({ input }) => {
        const { id, ...linkData } = input;
        const result = await this.repositoriesService.linkToService(
          id,
          linkData,
        );
        return {
          ...result,
          createdAt: result.createdAt.toISOString(),
        };
      }),

      // DELETE /repositories/:id/unlink/:serviceId - Unlink repository
      unlink: implement(repositoriesContract.unlink).handler(
        async ({ input }) => {
          await this.repositoriesService.unlinkFromService(
            input.id,
            input.serviceId,
          );
        },
      ),
    };
  }
}
