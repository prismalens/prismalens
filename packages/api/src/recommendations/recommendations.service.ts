import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Recommendation } from '../../prisma/generated/client.js';
import { UpdateRecommendationDto } from './dto/index.js';

export type { Recommendation };

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Recommendation | null> {
    return this.prisma.recommendation.findUnique({
      where: { id },
    });
  }

  async findByAnalysisRunId(analysisRunId: string): Promise<Recommendation[]> {
    return this.prisma.recommendation.findMany({
      where: { analysisRunId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findAll(options?: {
    status?: string;
    priority?: string;
    limit?: number;
    offset?: number;
  }): Promise<Recommendation[]> {
    return this.prisma.recommendation.findMany({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.priority && { priority: options.priority }),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async update(
    id: string,
    dto: UpdateRecommendationDto,
  ): Promise<Recommendation | null> {
    try {
      const recommendation = await this.prisma.recommendation.update({
        where: { id },
        data: {
          ...dto,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Updated recommendation ${id}`);
      return recommendation;
    } catch {
      return null;
    }
  }

  async count(options?: { status?: string; priority?: string }): Promise<number> {
    return this.prisma.recommendation.count({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.priority && { priority: options.priority }),
      },
    });
  }

  async getStatsByStatus(): Promise<Record<string, number>> {
    const results = await this.prisma.recommendation.groupBy({
      by: ['status'],
      _count: true,
    });

    return results.reduce(
      (acc, item) => {
        acc[item.status] = item._count;
        return acc;
      },
      {} as Record<string, number>,
    );
  }
}
