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
import { IncidentsService } from './incidents.service.js';
import { InvestigationsService } from '../investigations/investigations.service.js';
import { QueueService } from '../../infrastructure/queue/queue.service.js';
import { CreateIncidentDto, UpdateIncidentDto, AddAlertDto } from './dto/index.js';
import type { Incident, IncidentWithRelations } from './incidents.service.js';

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly investigationsService: InvestigationsService,
    private readonly queueService: QueueService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateIncidentDto): Promise<Incident> {
    return this.incidentsService.create(dto);
  }

  @Get()
  async findAll(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('priority') priority?: string,
    @Query('serviceId') serviceId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<IncidentWithRelations[]> {
    return this.incidentsService.findAll({
      status,
      severity,
      priority,
      serviceId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('active')
  async findActive(): Promise<IncidentWithRelations[]> {
    return this.incidentsService.findActive();
  }

  @Get('stats')
  async getStats() {
    return this.incidentsService.getStats();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<IncidentWithRelations> {
    const incident = await this.incidentsService.findById(id);

    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }

    return incident;
  }

  @Get('number/:number')
  async findByNumber(@Param('number') number: string): Promise<IncidentWithRelations> {
    const incident = await this.incidentsService.findByNumber(parseInt(number, 10));

    if (!incident) {
      throw new NotFoundException(`Incident INC-${number} not found`);
    }

    return incident;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateIncidentDto,
  ): Promise<Incident> {
    const incident = await this.incidentsService.update(id, dto);

    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }

    return incident;
  }

  @Post(':id/investigate')
  @HttpCode(HttpStatus.ACCEPTED)
  async investigate(@Param('id') id: string): Promise<{
    incidentId: string;
    investigationId: string;
    jobId: string | null;
    queued: boolean;
  }> {
    const incident = await this.incidentsService.findById(id);

    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }

    // Update incident status to investigating
    await this.incidentsService.update(id, { status: 'investigating' });

    // Create investigation
    const investigation = await this.investigationsService.create({
      incidentId: id,
    });

    // Queue the investigation job
    const jobId = await this.queueService.addInvestigationJob({
      incidentId: id,
      investigationId: investigation.id,
      priority: this.mapPriorityToJobPriority(incident.priority),
      context: {
        title: incident.title,
        severity: incident.severity,
        alertCount: incident.alertCount,
        serviceName: incident.service?.name,
      },
    });

    return {
      incidentId: id,
      investigationId: investigation.id,
      jobId,
      queued: jobId !== null,
    };
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Param('id') id: string): Promise<Incident> {
    const incident = await this.incidentsService.resolve(id);

    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }

    return incident;
  }

  @Post(':id/alerts')
  @HttpCode(HttpStatus.CREATED)
  async addAlert(
    @Param('id') id: string,
    @Body() dto: AddAlertDto,
  ): Promise<{ success: boolean }> {
    const incident = await this.incidentsService.findById(id);

    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }

    const success = await this.incidentsService.addAlert(id, dto.alertId);

    if (!success) {
      throw new NotFoundException(`Alert ${dto.alertId} not found or already correlated`);
    }

    return { success };
  }

  private mapPriorityToJobPriority(priority: string): 'low' | 'normal' | 'high' | 'critical' {
    switch (priority) {
      case 'p1':
        return 'critical';
      case 'p2':
        return 'high';
      case 'p3':
        return 'normal';
      case 'p4':
      case 'p5':
        return 'low';
      default:
        return 'normal';
    }
  }
}
