import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecommendationsService } from './recommendations.service.js';
import { UpdateRecommendationDto } from './dto/index.js';
import type { Recommendation, RecommendationWithRelations } from './recommendations.service.js';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('urgency') urgency?: string,
    @Query('investigationId') investigationId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<RecommendationWithRelations[]> {
    return this.recommendationsService.findAll({
      status,
      priority,
      urgency,
      investigationId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('stats')
  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  }> {
    const [total, byStatus, byPriority] = await Promise.all([
      this.recommendationsService.count(),
      this.recommendationsService.getStatsByStatus(),
      this.recommendationsService.getStatsByPriority(),
    ]);

    return { total, byStatus, byPriority };
  }

  @Get('investigation/:investigationId')
  async findByInvestigation(
    @Param('investigationId') investigationId: string,
  ): Promise<Recommendation[]> {
    return this.recommendationsService.findByInvestigationId(investigationId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<RecommendationWithRelations> {
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

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Param('id') id: string): Promise<Recommendation> {
    const recommendation = await this.recommendationsService.complete(id);

    if (!recommendation) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    return recommendation;
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(@Param('id') id: string): Promise<Recommendation> {
    const recommendation = await this.recommendationsService.dismiss(id);

    if (!recommendation) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }

    return recommendation;
  }
}
