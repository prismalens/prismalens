import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { RecommendationsService } from './recommendations.service.js';
import { UpdateRecommendationDto } from './dto/index.js';
import type { Recommendation } from './recommendations.service.js';

@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Recommendation[]> {
    return this.recommendationsService.findAll({
      status,
      priority,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('stats')
  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
  }> {
    const [total, byStatus] = await Promise.all([
      this.recommendationsService.count(),
      this.recommendationsService.getStatsByStatus(),
    ]);

    return { total, byStatus };
  }

  @Get('analysis-run/:analysisRunId')
  async findByAnalysisRun(
    @Param('analysisRunId') analysisRunId: string,
  ): Promise<Recommendation[]> {
    return this.recommendationsService.findByAnalysisRunId(analysisRunId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Recommendation> {
    const recommendation = await this.recommendationsService.findById(id);

    if (!recommendation) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    return recommendation;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRecommendationDto,
  ): Promise<Recommendation> {
    const recommendation = await this.recommendationsService.update(id, dto);

    if (!recommendation) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    return recommendation;
  }
}
