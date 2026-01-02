import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  NotFoundException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvestigationsService } from './investigations.service.js';
import { InvestigationResultDto } from './dto/index.js';
import type { InvestigationWithRelations } from './investigations.service.js';
import { QueueService } from '../../infrastructure/queue/queue.service.js';
import { InternalGuard } from '../../infrastructure/internal/guards/internal.guard.js';

@ApiTags('investigations')
@Controller('investigations')
export class InvestigationsController {
  constructor(
    private readonly investigationsService: InvestigationsService,
    private readonly queueService: QueueService,
  ) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<InvestigationWithRelations[]> {
    return this.investigationsService.findAll({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('queue/stats')
  async getQueueStats(): Promise<{
    enabled: boolean;
    stats: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    } | null;
  }> {
    const stats = await this.queueService.getQueueStats();

    return {
      enabled: this.queueService.isEnabled(),
      stats,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<InvestigationWithRelations> {
    const investigation = await this.investigationsService.findById(id);

    if (!investigation) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return investigation;
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string): Promise<{
    investigation: InvestigationWithRelations | null;
    job: {
      status: string;
      progress: number;
    } | null;
  }> {
    const investigation = await this.investigationsService.findById(id);
    const jobId = `investigation-${id}`;
    const jobStatus = await this.queueService.getJobStatus(jobId);

    if (!investigation && !jobStatus) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return {
      investigation,
      job: jobStatus
        ? {
            status: jobStatus.status,
            progress: jobStatus.progress,
          }
        : null,
    };
  }

  @Get(':id/agents')
  async getAgentExecutions(@Param('id') id: string) {
    const investigation = await this.investigationsService.findById(id);

    if (!investigation) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return this.investigationsService.getAgentExecutions(id);
  }

  @Get(':id/tools')
  async getToolExecutions(@Param('id') id: string) {
    const investigation = await this.investigationsService.findById(id);

    if (!investigation) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return this.investigationsService.getToolExecutions(id);
  }

  @Get('incident/:incidentId')
  async findByIncident(@Param('incidentId') incidentId: string) {
    return this.investigationsService.findByIncidentId(incidentId);
  }

  /**
   * Internal endpoint for worker to set investigation result.
   * Protected by InternalGuard - requires X-Internal-Secret header.
   */
  @Post(':id/result')
  @UseGuards(InternalGuard)
  @HttpCode(HttpStatus.OK)
  async setResult(
    @Param('id') id: string,
    @Body() dto: InvestigationResultDto,
  ): Promise<InvestigationWithRelations> {
    const investigation = await this.investigationsService.setResult(id, dto);

    if (!investigation) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return investigation;
  }
}
