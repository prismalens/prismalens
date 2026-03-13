import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Deployment } from '@prismalens/database';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type {
  BatchCreateDeploymentsDto,
  LinkDeploymentDto,
} from './dto/index.js';

export type { Deployment };

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch create deployments (upsert by connectionId + externalId)
   */
  async batchCreate(
    dto: BatchCreateDeploymentsDto,
  ): Promise<{ created: number; deployments: Deployment[] }> {
    const results: Deployment[] = [];

    for (const dep of dto.deployments) {
      const deployment = await this.prisma.deployment.upsert({
        where: {
          connectionId_externalId: {
            connectionId: dep.connectionId,
            externalId: dep.externalId,
          },
        },
        update: {
          name: dep.name,
          url: dep.url ?? null,
          status: dep.status ?? null,
          environment: dep.environment ?? null,
          deploymentType: dep.deploymentType ?? null,
          region: dep.region ?? null,
          branch: dep.branch ?? null,
          repositoryUrl: dep.repositoryUrl ?? null,
          metadata: dep.metadata ? JSON.stringify(dep.metadata) : null,
          lastDeployedAt: dep.lastDeployedAt
            ? new Date(dep.lastDeployedAt)
            : null,
        },
        create: {
          connectionId: dep.connectionId,
          externalId: dep.externalId,
          name: dep.name,
          url: dep.url ?? null,
          status: dep.status ?? null,
          environment: dep.environment ?? null,
          deploymentType: dep.deploymentType ?? null,
          region: dep.region ?? null,
          branch: dep.branch ?? null,
          repositoryUrl: dep.repositoryUrl ?? null,
          metadata: dep.metadata ? JSON.stringify(dep.metadata) : null,
          lastDeployedAt: dep.lastDeployedAt
            ? new Date(dep.lastDeployedAt)
            : null,
        },
      });
      results.push(deployment);
    }

    this.logger.log(`Batch created/updated ${results.length} deployments`);
    return { created: results.length, deployments: results };
  }

  /**
   * List all deployments with optional filters
   */
  async findAll(options?: {
    connectionId?: string;
    serviceId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Deployment[]; total: number }> {
    const where: Record<string, unknown> = {
      ...(options?.connectionId && { connectionId: options.connectionId }),
      ...(options?.serviceId && { serviceId: options.serviceId }),
    };

    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { url: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.deployment.findMany({
        where,
        orderBy: { name: 'asc' },
        take: options?.limit,
        skip: options?.offset,
      }),
      this.prisma.deployment.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Find deployment by ID
   */
  async findById(id: string): Promise<Deployment | null> {
    return this.prisma.deployment.findUnique({
      where: { id },
    });
  }

  /**
   * Link a deployment to a service
   */
  async linkToService(
    deploymentId: string,
    dto: LinkDeploymentDto,
  ): Promise<Deployment> {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');

    return this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { serviceId: dto.serviceId },
    });
  }

  /**
   * Unlink a deployment from its service
   */
  async unlinkFromService(deploymentId: string): Promise<void> {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { serviceId: null },
    });
  }
}
