import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { incidentsContract } from '@prismalens/contracts';
import { QueueService } from '../../infrastructure/queue/queue.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InvestigationsService } from '../investigations/investigations.service.js';
import type { Incident as PrismaIncident } from '@prismalens/database';
import type {
  Incident,
  IncidentWithRelations,
} from '@prismalens/contracts/schemas';
import type { CreateIncidentDto, UpdateIncidentDto } from './dto/index.js';
import { IncidentsService } from './incidents.service.js';

@Controller()
export class IncidentsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly investigationsService: InvestigationsService,
    private readonly queueService: QueueService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  @Implement(incidentsContract)
  incidents() {
    return {
      // POST /incidents - Create a new incident
      create: implement(incidentsContract.create).handler(async ({ input }) => {
        const incident = await this.incidentsService.create(
          input as CreateIncidentDto,
        );
        return this.serializeIncident(incident);
      }),

      // GET /incidents - List incidents with filtering
      list: implement(incidentsContract.list).handler(async ({ input }) => {
        const incidents = await this.incidentsService.findAll({
          status: input.status,
          severity: input.severity,
          priority: input.priority,
          serviceId: input.serviceId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          limit: input.limit,
          offset: input.offset,
        });
        return incidents.map((i) => this.serializeIncidentWithRelations(i));
      }),

      // GET /incidents/active - List active incidents
      listActive: implement(incidentsContract.listActive).handler(async () => {
        const incidents = await this.incidentsService.findActive();
        return incidents.map((i) => this.serializeIncidentWithRelations(i));
      }),

      // GET /incidents/stats - Get incident statistics
      getStats: implement(incidentsContract.getStats).handler(async () => {
        const stats = await this.incidentsService.getStats();
        const activeCount =
          (stats.byStatus?.['open'] ?? 0) +
          (stats.byStatus?.['investigating'] ?? 0);
        return {
          total: stats.total,
          active: activeCount,
          byStatus: stats.byStatus,
          bySeverity: stats.bySeverity,
          byPriority: {},
          avgTimeToAcknowledge: stats.avgTimeToAcknowledge,
          avgTimeToResolve: stats.avgTimeToResolve,
        };
      }),

      // GET /incidents/:id - Get a single incident
      get: implement(incidentsContract.get).handler(async ({ input }) => {
        const incident = await this.incidentsService.findById(input.id);
        if (!incident) {
          throw new ORPCError('NOT_FOUND', {
            message: `Incident ${input.id} not found`,
          });
        }
        return this.serializeIncidentWithRelations(incident);
      }),

      // GET /incidents/number/:number - Get incident by number
      getByNumber: implement(incidentsContract.getByNumber).handler(
        async ({ input }) => {
          const incident = await this.incidentsService.findByNumber(
            input.number,
          );
          if (!incident) {
            throw new ORPCError('NOT_FOUND', {
              message: `Incident INC-${input.number} not found`,
            });
          }
          return this.serializeIncidentWithRelations(incident);
        },
      ),

      // PATCH /incidents/:id - Update an incident
      update: implement(incidentsContract.update).handler(async ({ input }) => {
        const { id, ...updateData } = input;
        const incident = await this.incidentsService.update(
          id,
          updateData as UpdateIncidentDto,
        );
        if (!incident) {
          throw new ORPCError('NOT_FOUND', {
            message: `Incident ${id} not found`,
          });
        }
        return this.serializeIncident(incident);
      }),

      // POST /incidents/:id/investigate - Start investigation
      investigate: implement(incidentsContract.investigate).handler(
        async ({ input }) => {
          const incident = await this.incidentsService.findById(input.id);
          if (!incident) {
            throw new ORPCError('NOT_FOUND', {
              message: `Incident ${input.id} not found`,
            });
          }

          // Update incident status to investigating
          await this.incidentsService.update(input.id, {
            status: 'investigating',
          });

          // Create investigation
          const investigation = await this.investigationsService.create({
            incidentId: input.id,
          });

          // Fetch integrations and extract connectionIds for the queue payload.
          // Only connectionIds go to Redis — worker fetches credentials on-demand.
          const integrations =
            await this.integrationsService.getIntegrationsForService(
              incident.serviceId ?? undefined,
            );
          const connectionIds = integrations.map((i) => i.connectionId);

          // Queue the investigation job
          const jobId = await this.queueService.addInvestigationJob({
            incidentId: input.id,
            investigationId: investigation.id,
            priority: this.mapPriorityToJobPriority(incident.priority),
            context: {
              title: incident.title,
              severity: incident.severity,
              alertCount: incident.alertCount,
              serviceName: incident.service?.name,
            },
            connectionIds,
          });

          return {
            incidentId: input.id,
            investigationId: investigation.id,
            jobId,
            queued: jobId !== null,
          };
        },
      ),

      // POST /incidents/:id/resolve - Resolve an incident
      resolve: implement(incidentsContract.resolve).handler(
        async ({ input }) => {
          const incident = await this.incidentsService.resolve(input.id);
          if (!incident) {
            throw new ORPCError('NOT_FOUND', {
              message: `Incident ${input.id} not found`,
            });
          }
          return this.serializeIncident(incident);
        },
      ),

      // POST /incidents/:id/alerts - Add an alert to an incident
      addAlert: implement(incidentsContract.addAlert).handler(
        async ({ input }) => {
          const incident = await this.incidentsService.findById(input.id);
          if (!incident) {
            throw new ORPCError('NOT_FOUND', {
              message: `Incident ${input.id} not found`,
            });
          }

          const success = await this.incidentsService.addAlert(
            input.id,
            input.alertId,
          );
          if (!success) {
            throw new ORPCError('NOT_FOUND', {
              message: `Alert ${input.alertId} not found or already correlated`,
            });
          }

          return { success };
        },
      ),
    };
  }

  private mapPriorityToJobPriority(
    priority: string,
  ): 'low' | 'normal' | 'high' | 'critical' {
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

  private serializeIncident(incident: PrismaIncident): Incident {
    return {
      ...incident,
      tags: incident.tags ? JSON.parse(incident.tags) : null,
      triggeredAt: incident.triggeredAt?.toISOString(),
      acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      createdAt: incident.createdAt?.toISOString(),
      updatedAt: incident.updatedAt?.toISOString(),
    } as Incident;
  }

  private serializeIncidentWithRelations(
    incident: Record<string, any>,
  ): IncidentWithRelations {
    const serialized = this.serializeIncident(
      incident as PrismaIncident,
    ) as any;

    if (incident.service) {
      serialized.service = {
        id: incident.service.id,
        name: incident.service.name,
        type: incident.service.type,
        tier: incident.service.tier,
      };
    }

    if (incident.alerts) {
      serialized.alerts = incident.alerts.map((a: any) => ({
        id: a.id,
        title: a.title,
        severity: a.severity,
        status: a.status,
      }));
    }

    if (incident.investigations) {
      serialized.investigations = incident.investigations.map((i: any) => ({
        id: i.id,
        status: i.status,
      }));
    }

    return serialized as IncidentWithRelations;
  }
}
