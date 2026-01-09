import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { Alert, Incident } from '@prismalens/database';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TimelineEntryType, TimelineSource } from '../../shared/enums/index.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { CreateIncidentDto, UpdateIncidentDto } from './dto/index.js';

export type { Incident };

export type IncidentWithRelations = Incident & {
  alerts: Alert[];
  service?: { id: string; name: string; displayName: string | null } | null;
  investigations?: Array<{
    id: string;
    status: string;
    summary: string | null;
    rootCause: string | null;
    confidence: number | null;
    createdAt: Date;
  }>;
  _count?: {
    alerts: number;
    investigations: number;
  };
};

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TimelineService))
    private readonly timelineService: TimelineService,
  ) {}

  /**
   * Create a new incident
   */
  async create(dto: CreateIncidentDto): Promise<Incident> {
    // Get next incident number (application-managed for SQLite compatibility)
    const lastIncident = await this.prisma.incident.findFirst({
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const nextNumber = (lastIncident?.number ?? 0) + 1;

    const incident = await this.prisma.incident.create({
      data: {
        number: nextNumber,
        title: dto.title,
        description: dto.description,
        severity: dto.severity ?? 'medium',
        status: 'triggered',
        priority: dto.priority ?? 'p3',
        serviceId: dto.serviceId,
        correlationReason: dto.correlationReason,
        tags: dto.tags ? JSON.stringify(dto.tags) : null,
        customerImpact: dto.customerImpact,
        alertCount: 0,
      },
    });

    this.logger.log(`Created incident INC-${incident.number}: ${incident.title}`);

    // Create timeline entry
    await this.timelineService.create({
      incidentId: incident.id,
      type: TimelineEntryType.INCIDENT_CREATED,
      title: 'Incident created',
      description: `Incident INC-${incident.number} was created`,
      source: TimelineSource.SYSTEM,
    });

    return incident;
  }

  /**
   * Find incident by ID with full relations
   */
  async findById(id: string): Promise<IncidentWithRelations | null> {
    return this.prisma.incident.findUnique({
      where: { id },
      include: {
        alerts: {
          orderBy: { triggeredAt: 'desc' },
        },
        service: {
          select: { id: true, name: true, displayName: true },
        },
        investigations: {
          select: {
            id: true,
            status: true,
            summary: true,
            rootCause: true,
            confidence: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { alerts: true, investigations: true },
        },
      },
    });
  }

  /**
   * Find incident by number (human-readable ID)
   */
  async findByNumber(number: number): Promise<IncidentWithRelations | null> {
    return this.prisma.incident.findUnique({
      where: { number },
      include: {
        alerts: {
          orderBy: { triggeredAt: 'desc' },
        },
        service: {
          select: { id: true, name: true, displayName: true },
        },
        investigations: {
          select: {
            id: true,
            status: true,
            summary: true,
            rootCause: true,
            confidence: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  /**
   * Find all incidents with filters
   */
  async findAll(options?: {
    status?: string;
    severity?: string;
    priority?: string;
    serviceId?: string;
    limit?: number;
    offset?: number;
  }): Promise<IncidentWithRelations[]> {
    return this.prisma.incident.findMany({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.severity && { severity: options.severity }),
        ...(options?.priority && { priority: options.priority }),
        ...(options?.serviceId && { serviceId: options.serviceId }),
      },
      include: {
        alerts: {
          take: 5, // Only include first 5 alerts for list view
          orderBy: { triggeredAt: 'desc' },
        },
        service: {
          select: { id: true, name: true, displayName: true },
        },
        _count: {
          select: { alerts: true, investigations: true },
        },
      },
      orderBy: [
        { priority: 'asc' },
        { severity: 'asc' },
        { triggeredAt: 'desc' },
      ],
      take: options?.limit,
      skip: options?.offset,
    });
  }

  /**
   * Find active (open) incidents
   */
  async findActive(): Promise<IncidentWithRelations[]> {
    return this.findAll({
      status: undefined, // We'll filter below
    }).then(incidents =>
      incidents.filter(i => !['resolved', 'closed'].includes(i.status))
    );
  }

  /**
   * Update incident
   */
  async update(id: string, dto: UpdateIncidentDto): Promise<Incident | null> {
    try {
      const existing = await this.prisma.incident.findUnique({ where: { id } });
      if (!existing) return null;

      const updateData: Record<string, unknown> = {
        ...dto,
        updatedAt: new Date(),
      };

      if (dto.tags) {
        updateData.tags = JSON.stringify(dto.tags);
      }

      // Track status changes
      if (dto.status && dto.status !== existing.status) {
        if (dto.status === 'investigating' && !existing.acknowledgedAt) {
          updateData.acknowledgedAt = new Date();
          updateData.timeToAcknowledge = Math.floor(
            (Date.now() - existing.triggeredAt.getTime()) / 1000
          );
        }
        if (dto.status === 'resolved' && !existing.resolvedAt) {
          updateData.resolvedAt = new Date();
          updateData.timeToResolve = Math.floor(
            (Date.now() - existing.triggeredAt.getTime()) / 1000
          );
        }
      }

      const incident = await this.prisma.incident.update({
        where: { id },
        data: updateData,
      });

      // Create timeline entry for status change
      if (dto.status && dto.status !== existing.status) {
        await this.timelineService.create({
          incidentId: id,
          type: TimelineEntryType.STATUS_CHANGED,
          title: 'Status changed',
          description: `Status changed from ${existing.status} to ${dto.status}`,
          source: TimelineSource.SYSTEM,
          metadata: { previousStatus: existing.status, newStatus: dto.status },
        });
      }

      this.logger.log(`Updated incident ${id}`);
      return incident;
    } catch {
      return null;
    }
  }

  /**
   * Add an alert to an incident (correlation)
   */
  async addAlert(incidentId: string, alertId: string): Promise<boolean> {
    try {
      await this.prisma.$transaction([
        // Update alert to point to incident
        this.prisma.alert.update({
          where: { id: alertId },
          data: {
            incidentId,
            status: 'correlated',
          },
        }),
        // Update incident alert count
        this.prisma.incident.update({
          where: { id: incidentId },
          data: {
            alertCount: { increment: 1 },
          },
        }),
      ]);

      // Create timeline entry
      const alert = await this.prisma.alert.findUnique({
        where: { id: alertId },
        select: { title: true },
      });

      await this.timelineService.create({
        incidentId,
        type: TimelineEntryType.ALERT_ADDED,
        title: 'Alert added',
        description: `Alert "${alert?.title}" was correlated to this incident`,
        source: TimelineSource.SYSTEM,
        metadata: { alertId },
      });

      this.logger.log(`Added alert ${alertId} to incident ${incidentId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove an alert from an incident
   */
  async removeAlert(incidentId: string, alertId: string): Promise<boolean> {
    try {
      await this.prisma.$transaction([
        this.prisma.alert.update({
          where: { id: alertId },
          data: {
            incidentId: null,
            status: 'triggered',
          },
        }),
        this.prisma.incident.update({
          where: { id: incidentId },
          data: {
            alertCount: { decrement: 1 },
          },
        }),
      ]);

      await this.timelineService.create({
        incidentId,
        type: TimelineEntryType.ALERT_REMOVED,
        title: 'Alert removed',
        description: `Alert was removed from this incident`,
        source: TimelineSource.SYSTEM,
        metadata: { alertId },
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve an incident
   */
  async resolve(id: string): Promise<Incident | null> {
    return this.update(id, { status: 'resolved' });
  }

  /**
   * Close an incident (after postmortem)
   */
  async close(id: string): Promise<Incident | null> {
    return this.update(id, { status: 'closed' });
  }

  /**
   * Get incident statistics
   */
  async getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    avgTimeToAcknowledge: number | null;
    avgTimeToResolve: number | null;
  }> {
    const [total, byStatus, bySeverity, ttaResult, ttrResult] = await Promise.all([
      this.prisma.incident.count(),
      this.prisma.incident.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.incident.groupBy({
        by: ['severity'],
        _count: true,
      }),
      this.prisma.incident.aggregate({
        _avg: { timeToAcknowledge: true },
        where: { timeToAcknowledge: { not: null } },
      }),
      this.prisma.incident.aggregate({
        _avg: { timeToResolve: true },
        where: { timeToResolve: { not: null } },
      }),
    ]);

    return {
      total,
      byStatus: byStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>),
      bySeverity: bySeverity.reduce((acc, item) => {
        acc[item.severity] = item._count;
        return acc;
      }, {} as Record<string, number>),
      avgTimeToAcknowledge: ttaResult._avg.timeToAcknowledge,
      avgTimeToResolve: ttrResult._avg.timeToResolve,
    };
  }

  /**
   * Count incidents
   */
  async count(options?: {
    status?: string;
    severity?: string;
    priority?: string;
  }): Promise<number> {
    return this.prisma.incident.count({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.severity && { severity: options.severity }),
        ...(options?.priority && { priority: options.priority }),
      },
    });
  }
}
