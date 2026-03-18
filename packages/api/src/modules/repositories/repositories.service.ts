import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Repository, ServiceRepository } from '@prismalens/database';
import { Prisma } from '@prismalens/database';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type {
  BatchCreateRepositoriesDto,
  LinkRepositoryDto,
} from './dto/index.js';

export type { Repository, ServiceRepository };

@Injectable()
export class RepositoriesService {
  private readonly logger = new Logger(RepositoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch create repositories (upsert by connectionId + fullName)
   */
  async batchCreate(
    dto: BatchCreateRepositoriesDto,
  ): Promise<{ created: number; repositories: Repository[] }> {
    const results = await this.prisma.$transaction(async (tx) => {
      const repos: Repository[] = [];
      for (const repo of dto.repositories) {
        const repository = await tx.repository.upsert({
          where: {
            connectionId_fullName: {
              connectionId: repo.connectionId,
              fullName: repo.fullName,
            },
          },
          update: {
            url: repo.url,
            description: repo.description ?? null,
            language: repo.language ?? null,
            defaultBranch: repo.defaultBranch ?? 'main',
            isPrivate: repo.isPrivate ?? false,
            metadata: repo.metadata ? JSON.stringify(repo.metadata) : null,
          },
          create: {
            connectionId: repo.connectionId,
            fullName: repo.fullName,
            url: repo.url,
            description: repo.description ?? null,
            language: repo.language ?? null,
            defaultBranch: repo.defaultBranch ?? 'main',
            isPrivate: repo.isPrivate ?? false,
            metadata: repo.metadata ? JSON.stringify(repo.metadata) : null,
          },
        });
        repos.push(repository);
      }
      return repos;
    });

    this.logger.log(`Batch created/updated ${results.length} repositories`);
    return { created: results.length, repositories: results };
  }

  /**
   * Count repositories not linked to any service
   */
  async countUnlinked(): Promise<number> {
    const repos = await this.prisma.repository.findMany({
      include: { services: { select: { id: true }, take: 1 } },
    });
    return repos.filter((r) => r.services.length === 0).length;
  }

  /**
   * List all repositories with optional filters
   */
  async findAll(options?: {
    connectionId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Repository[]; total: number }> {
    const where: Record<string, unknown> = {
      ...(options?.connectionId && { connectionId: options.connectionId }),
    };

    if (options?.search) {
      where.OR = [
        { fullName: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.repository.findMany({
        where,
        include: { services: true },
        orderBy: { fullName: 'asc' },
        take: options?.limit,
        skip: options?.offset,
      }),
      this.prisma.repository.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Find repository by ID with linked services
   */
  async findById(id: string) {
    return this.prisma.repository.findUnique({
      where: { id },
      include: { services: true },
    });
  }

  /**
   * Link a repository to a service
   */
  async linkToService(
    repositoryId: string,
    dto: LinkRepositoryDto,
  ): Promise<ServiceRepository> {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    return this.prisma.serviceRepository.create({
      data: {
        serviceId: dto.serviceId,
        repositoryId,
        subPath: dto.subPath ?? null,
        isPrimary: dto.isPrimary ?? true,
      },
    });
  }

  /**
   * Unlink a repository from a service
   */
  async unlinkFromService(
    repositoryId: string,
    serviceId: string,
  ): Promise<void> {
    await this.prisma.serviceRepository.deleteMany({
      where: { repositoryId, serviceId },
    });
  }

  /**
   * Delete an unlinked repository
   */
  async delete(id: string): Promise<void> {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
      include: { services: true },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    if (repo.services.length > 0) {
      throw new ConflictException(
        'Repository is linked to services. Unlink before deleting.',
      );
    }
    await this.prisma.repository.delete({ where: { id } });
    this.logger.log(`Deleted repository ${repo.fullName} (${id})`);
  }
}
