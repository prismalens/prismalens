import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnalysisRun, Recommendation } from '../../prisma/generated/client.js';

export interface CreateRecommendationDto {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  category?: string;
}

export interface AnalysisResult {
  summary?: string;
  rootCause?: string;
  recommendations?: CreateRecommendationDto[];
  error?: string;
}

export type AnalysisRunWithRecommendations = AnalysisRun & {
  recommendations: Recommendation[];
};

export type { AnalysisRun, Recommendation };

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRun(alertId: string): Promise<AnalysisRun> {
    const run = await this.prisma.analysisRun.create({
      data: {
        alertId,
        status: 'pending',
      },
    });

    this.logger.log(`Created analysis run ${run.id} for alert ${alertId}`);
    return run;
  }

  async findById(id: string): Promise<AnalysisRunWithRecommendations | null> {
    return this.prisma.analysisRun.findUnique({
      where: { id },
      include: {
        recommendations: true,
      },
    });
  }

  async findByAlertId(alertId: string): Promise<AnalysisRunWithRecommendations[]> {
    return this.prisma.analysisRun.findMany({
      where: { alertId },
      include: {
        recommendations: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<AnalysisRunWithRecommendations[]> {
    return this.prisma.analysisRun.findMany({
      where: {
        ...(options?.status && { status: options.status }),
      },
      include: {
        recommendations: true,
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async updateStatus(id: string, status: string): Promise<AnalysisRun | null> {
    try {
      const updateData: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'running') {
        updateData.startedAt = new Date();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completedAt = new Date();
      }

      const run = await this.prisma.analysisRun.update({
        where: { id },
        data: updateData,
      });

      this.logger.log(`Updated analysis run ${id} to ${status}`);
      return run;
    } catch {
      return null;
    }
  }

  async setResult(id: string, result: AnalysisResult): Promise<AnalysisRunWithRecommendations | null> {
    try {
      // Update the analysis run
      const run = await this.prisma.analysisRun.update({
        where: { id },
        data: {
          summary: result.summary,
          rootCause: result.rootCause,
          rawOutput: result.error ? JSON.stringify({ error: result.error }) : null,
          status: result.error ? 'failed' : 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create recommendations if provided
      if (result.recommendations && result.recommendations.length > 0) {
        await this.prisma.recommendation.createMany({
          data: result.recommendations.map((rec) => ({
            analysisRunId: id,
            title: rec.title,
            description: rec.description,
            priority: rec.priority ?? 'medium',
            category: rec.category,
            status: 'pending',
          })),
        });
      }

      // Return with recommendations
      return this.findById(id);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.analysisRun.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }

  async count(options?: { status?: string }): Promise<number> {
    return this.prisma.analysisRun.count({
      where: {
        ...(options?.status && { status: options.status }),
      },
    });
  }
}
