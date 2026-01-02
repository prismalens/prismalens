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
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service.js';
import { CreateAlertDto, UpdateAlertDto } from './dto/index.js';
import type { Alert, AlertWithRelations } from './alerts.service.js';
import { CorrelationService } from '../correlation/correlation.service.js';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alertsService: AlertsService,
    @Inject(forwardRef(() => CorrelationService))
    private readonly correlationService: CorrelationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateAlertDto): Promise<{
    alert: Alert;
    correlation: {
      incidentId?: string;
      incidentNumber?: number;
      reason?: string;
      isNewIncident: boolean;
    };
  }> {
    // Create the alert
    const alert = await this.alertsService.create(dto);

    // Correlate to incident (creates new one if needed)
    const correlationResult = await this.correlationService.correlateAlert(alert);

    return {
      alert,
      correlation: {
        incidentId: correlationResult.incidentId,
        incidentNumber: correlationResult.incidentNumber,
        reason: correlationResult.reason,
        isNewIncident: correlationResult.isNewIncident,
      },
    };
  }

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('serviceId') serviceId?: string,
    @Query('incidentId') incidentId?: string,
    @Query('hasIncident') hasIncident?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AlertWithRelations[]> {
    return this.alertsService.findAll({
      status,
      severity,
      serviceId,
      incidentId,
      hasIncident: hasIncident !== undefined ? hasIncident === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('uncorrelated')
  async findUncorrelated(
    @Query('limit') limit?: string,
  ): Promise<Alert[]> {
    return this.alertsService.findUncorrelated(
      limit ? parseInt(limit, 10) : 100
    );
  }

  @Get('stats')
  async getStats() {
    return this.alertsService.getStats();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<AlertWithRelations> {
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

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  async acknowledge(@Param('id') id: string): Promise<Alert> {
    const alert = await this.alertsService.acknowledge(id);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    return alert;
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Param('id') id: string): Promise<Alert> {
    const alert = await this.alertsService.resolve(id);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    return alert;
  }

  @Post(':id/correlate')
  @HttpCode(HttpStatus.OK)
  async correlate(@Param('id') id: string): Promise<{
    alert: Alert;
    incidentId?: string;
    incidentNumber?: number;
    reason?: string;
    isNewIncident: boolean;
  }> {
    const alert = await this.alertsService.findById(id);

    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }

    // Already correlated?
    if (alert.incidentId) {
      return {
        alert,
        incidentId: alert.incident?.id,
        incidentNumber: alert.incident?.number,
        reason: 'Already correlated',
        isNewIncident: false,
      };
    }

    const result = await this.correlationService.correlateAlert(alert);

    // Refresh alert data
    const updatedAlert = await this.alertsService.findById(id);

    return {
      alert: updatedAlert!,
      incidentId: result.incidentId,
      incidentNumber: result.incidentNumber,
      reason: result.reason,
      isNewIncident: result.isNewIncident,
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
}
