import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { recommendationsContract } from '@prismalens/contracts';
import { RecommendationsService } from './recommendations.service.js';
import type { UpdateRecommendationDto } from './dto/index.js';

@Controller()
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Implement(recommendationsContract)
  recommendations() {
    return {
      // GET /recommendations - List recommendations with filtering
      list: implement(recommendationsContract.list).handler(async ({ input }) => {
        const recommendations = await this.recommendationsService.findAll({
          status: input.status,
          priority: input.priority,
          investigationId: input.investigationId,
          limit: input.limit,
          offset: input.offset,
        });
        return recommendations.map((r) => this.serializeRecommendationWithRelations(r));
      }),

      // GET /recommendations/stats - Get recommendation statistics
      getStats: implement(recommendationsContract.getStats).handler(async () => {
        const [total, byStatus, byPriority] = await Promise.all([
          this.recommendationsService.count(),
          this.recommendationsService.getStatsByStatus(),
          this.recommendationsService.getStatsByPriority(),
        ]);

        return { total, byStatus, byPriority, byCategory: {} };
      }),

      // GET /recommendations/:id - Get a single recommendation
      get: implement(recommendationsContract.get).handler(async ({ input }) => {
        const recommendation = await this.recommendationsService.findById(input.id);
        if (!recommendation) {
          throw new ORPCError('NOT_FOUND', { message: `Recommendation ${input.id} not found` });
        }
        return this.serializeRecommendationWithRelations(recommendation);
      }),

      // PATCH /recommendations/:id - Update a recommendation
      update: implement(recommendationsContract.update).handler(async ({ input }) => {
        const { id, ...updateData } = input;
        const recommendation = await this.recommendationsService.update(id, updateData as UpdateRecommendationDto);
        if (!recommendation) {
          throw new ORPCError('NOT_FOUND', { message: `Recommendation ${id} not found` });
        }
        return this.serializeRecommendation(recommendation);
      }),

      // POST /recommendations/:id/complete - Complete a recommendation
      complete: implement(recommendationsContract.complete).handler(async ({ input }) => {
        const recommendation = await this.recommendationsService.complete(input.id);
        if (!recommendation) {
          throw new ORPCError('NOT_FOUND', { message: `Recommendation ${input.id} not found` });
        }
        return this.serializeRecommendation(recommendation);
      }),

      // POST /recommendations/:id/dismiss - Dismiss a recommendation
      dismiss: implement(recommendationsContract.dismiss).handler(async ({ input }) => {
        const recommendation = await this.recommendationsService.dismiss(input.id);
        if (!recommendation) {
          throw new ORPCError('NOT_FOUND', { message: `Recommendation ${input.id} not found` });
        }
        return this.serializeRecommendation(recommendation);
      }),
    };
  }

  private serializeRecommendation(rec: any): any {
    return {
      ...rec,
      metadata: rec.metadata ? JSON.parse(rec.metadata) : null,
      createdAt: rec.createdAt?.toISOString(),
      updatedAt: rec.updatedAt?.toISOString(),
      completedAt: rec.completedAt?.toISOString() ?? null,
    };
  }

  private serializeRecommendationWithRelations(rec: any): any {
    const serialized = this.serializeRecommendation(rec);

    if (rec.investigation) {
      serialized.investigation = {
        id: rec.investigation.id,
        status: rec.investigation.status,
        incidentId: rec.investigation.incidentId,
      };
    }

    return serialized;
  }
}
