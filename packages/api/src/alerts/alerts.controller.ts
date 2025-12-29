import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AlertsService } from './alerts.service.js';
import { CreateAlertDto, UpdateAlertDto } from './dto/index.js';
import type { Alert } from './alerts.service.js';
import { QueueService } from '../queue/queue.service.js';
import { AnalysisService } from '../analysis/analysis.service.js';

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly queueService: QueueService,
    private readonly analysisService: AnalysisService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateAlertDto): Promise<Alert> {
    return this.alertsService.create(dto);
  }

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Alert[]> {
    return this.alertsService.findAll({
      status,
      severity,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Alert> {
    const alert = await this.alertsService.findById(id);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    return alert;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAlertDto,
  ): Promise<Alert> {
    const alert = await this.alertsService.update(id, dto);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    return alert;
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ): Promise<Alert> {
    const alert = await this.alertsService.updateStatus(id, status);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    return alert;
  }

  @Post(':id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  async analyze(@Param('id') id: string): Promise<{
    alertId: string;
    analysisRunId: string;
    jobId: string | null;
    queued: boolean;
  }> {
    const alert = await this.alertsService.findById(id);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    // Update status to analyzing
    await this.alertsService.updateStatus(id, 'analyzing');

    // Create analysis run in database
    const analysisRun = await this.analysisService.createRun(id);

    // Queue analysis job
    const jobId = await this.queueService.addAnalysisJob({
      alertId: id,
      analysisRunId: analysisRun.id,
      priority: this.mapSeverityToPriority(alert.severity),
      context: {
        source: alert.source,
        title: alert.title,
      },
    });

    return {
      alertId: id,
      analysisRunId: analysisRun.id,
      jobId,
      queued: jobId !== null,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    const deleted = await this.alertsService.delete(id);

    if (!deleted) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
  }

  private mapSeverityToPriority(
    severity: string,
  ): 'low' | 'normal' | 'high' | 'critical' {
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
        return 'normal';
      case 'low':
        return 'low';
      default:
        return 'normal';
    }
  }
}
