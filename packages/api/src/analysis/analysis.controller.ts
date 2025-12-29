import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { AnalysisService, AnalysisRunWithRecommendations } from './analysis.service.js';
import { QueueService } from '../queue/queue.service.js';

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly queueService: QueueService,
  ) {}

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AnalysisRunWithRecommendations[]> {
    return this.analysisService.findAll({
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
  async findOne(@Param('id') id: string): Promise<AnalysisRunWithRecommendations> {
    const run = await this.analysisService.findById(id);

    if (!run) {
      throw new NotFoundException(`Analysis run ${id} not found`);
    }

    return run;
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string): Promise<{
    analysisRun: AnalysisRunWithRecommendations | null;
    job: {
      status: string;
      progress: number;
    } | null;
  }> {
    const run = await this.analysisService.findById(id);
    const jobId = `analysis-${id}`;
    const jobStatus = await this.queueService.getJobStatus(jobId);

    if (!run && !jobStatus) {
      throw new NotFoundException(`Analysis ${id} not found`);
    }

    return {
      analysisRun: run,
      job: jobStatus
        ? {
            status: jobStatus.status,
            progress: jobStatus.progress,
          }
        : null,
    };
  }

  @Get('alert/:alertId')
  async findByAlert(
    @Param('alertId') alertId: string,
  ): Promise<AnalysisRunWithRecommendations[]> {
    return this.analysisService.findByAlertId(alertId);
  }
}
