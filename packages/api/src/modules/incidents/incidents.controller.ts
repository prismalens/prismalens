// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { incidentsContract, toFiringAlert } from "@prismalens/contracts";
import type {
	Alert,
	Incident,
	IncidentWithRelations,
} from "@prismalens/contracts/schemas";
import type {
	Alert as PrismaAlert,
	Incident as PrismaIncident,
} from "@prismalens/database";
import { QueueService } from "../../infrastructure/queue/queue.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import type { CreateIncidentDto, UpdateIncidentDto } from "./dto/index.js";
import { IncidentsService } from "./incidents.service.js";

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
				const { data, total } = await this.incidentsService.findAll({
					status: input.status,
					severity: input.severity,
					priority: input.priority,
					serviceId: input.serviceId,
					fromDate: input.fromDate,
					toDate: input.toDate,
					limit: input.limit,
					offset: input.offset,
				});
				const limit = input.limit;
				const offset = input.offset;
				return {
					data: data.map((i) => this.serializeIncidentWithRelations(i)),
					pagination: {
						total,
						limit,
						offset,
						hasMore: offset + data.length < total,
					},
				};
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
					(stats.byStatus?.open ?? 0) + (stats.byStatus?.investigating ?? 0);
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
					throw new ORPCError("NOT_FOUND", {
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
						throw new ORPCError("NOT_FOUND", {
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
					throw new ORPCError("NOT_FOUND", {
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
						throw new ORPCError("NOT_FOUND", {
							message: `Incident ${input.id} not found`,
						});
					}

					// Update incident status to investigating
					await this.incidentsService.update(input.id, {
						status: "investigating",
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
						alerts: incident.alerts
							? incident.alerts.map((a: Record<string, unknown>) =>
									toFiringAlert(a),
								)
							: undefined,
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
						throw new ORPCError("NOT_FOUND", {
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
						throw new ORPCError("NOT_FOUND", {
							message: `Incident ${input.id} not found`,
						});
					}

					const success = await this.incidentsService.addAlert(
						input.id,
						input.alertId,
					);
					if (!success) {
						throw new ORPCError("NOT_FOUND", {
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
	): "low" | "normal" | "high" | "critical" {
		switch (priority) {
			case "p1":
				return "critical";
			case "p2":
				return "high";
			case "p3":
				return "normal";
			case "p4":
			case "p5":
				return "low";
			default:
				return "normal";
		}
	}

	private serializeIncident(incident: PrismaIncident): Incident {
		return {
			...incident,
			description: incident.description ?? null,
			serviceId: incident.serviceId ?? null,
			assignedToId: incident.assignedToId ?? null,
			correlationReason: incident.correlationReason ?? null,
			correlationRuleId: incident.correlationRuleId ?? null,
			customerImpact: incident.customerImpact ?? null,
			affectedSystems: incident.affectedSystems
				? JSON.parse(incident.affectedSystems)
				: null,
			timeToAcknowledge: incident.timeToAcknowledge ?? null,
			timeToResolve: incident.timeToResolve ?? null,
			tags: incident.tags ? JSON.parse(incident.tags) : null,
			triggeredAt: incident.triggeredAt?.toISOString(),
			acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
			resolvedAt: incident.resolvedAt?.toISOString() ?? null,
			createdAt: incident.createdAt?.toISOString(),
			updatedAt: incident.updatedAt?.toISOString(),
		} as Incident;
	}

	private serializeAlert(alert: PrismaAlert | Record<string, any>): Alert {
		return {
			...alert,
			fingerprint: alert.fingerprint ?? null,
			externalId: alert.externalId ?? null,
			description: alert.description ?? null,
			source: alert.source ?? null,
			sourceUrl: alert.sourceUrl ?? null,
			serviceId: alert.serviceId ?? null,
			incidentId: alert.incidentId ?? null,
			rawPayload: alert.rawPayload ?? null,
			tags: alert.tags
				? typeof alert.tags === "string"
					? JSON.parse(alert.tags)
					: alert.tags
				: null,
			labels: alert.labels
				? typeof alert.labels === "string"
					? JSON.parse(alert.labels)
					: alert.labels
				: null,
			triggeredAt:
				alert.triggeredAt instanceof Date
					? alert.triggeredAt.toISOString()
					: alert.triggeredAt,
			acknowledgedAt:
				alert.acknowledgedAt instanceof Date
					? alert.acknowledgedAt.toISOString()
					: (alert.acknowledgedAt ?? null),
			resolvedAt:
				alert.resolvedAt instanceof Date
					? alert.resolvedAt.toISOString()
					: (alert.resolvedAt ?? null),
			lastOccurrence:
				alert.lastOccurrence instanceof Date
					? alert.lastOccurrence.toISOString()
					: alert.lastOccurrence,
			createdAt:
				alert.createdAt instanceof Date
					? alert.createdAt.toISOString()
					: alert.createdAt,
			updatedAt:
				alert.updatedAt instanceof Date
					? alert.updatedAt.toISOString()
					: alert.updatedAt,
		} as Alert;
	}

	private serializeIncidentWithRelations(
		incident: Record<string, any>,
	): IncidentWithRelations {
		const serialized = this.serializeIncident(
			incident as PrismaIncident,
		) as any;

		if (incident.service) {
			serialized.service = {
				...incident.service,
				displayName: incident.service.displayName ?? null,
				description: incident.service.description ?? null,
				team: incident.service.team ?? null,
				slackChannel: incident.service.slackChannel ?? null,
				tags: incident.service.tags
					? typeof incident.service.tags === "string"
						? JSON.parse(incident.service.tags)
						: incident.service.tags
					: null,
				metadata: incident.service.metadata
					? typeof incident.service.metadata === "string"
						? JSON.parse(incident.service.metadata)
						: incident.service.metadata
					: null,
				createdAt:
					incident.service.createdAt instanceof Date
						? incident.service.createdAt.toISOString()
						: incident.service.createdAt,
				updatedAt:
					incident.service.updatedAt instanceof Date
						? incident.service.updatedAt.toISOString()
						: incident.service.updatedAt,
			};
		}

		if (incident.alerts) {
			serialized.alerts = incident.alerts.map((a: any) =>
				this.serializeAlert(a),
			);
		}

		if (incident.investigations) {
			serialized.investigations = incident.investigations.map((i: any) => ({
				id: i.id,
				status: i.status,
				createdAt:
					i.createdAt instanceof Date ? i.createdAt.toISOString() : i.createdAt,
				completedAt:
					i.completedAt instanceof Date
						? i.completedAt.toISOString()
						: (i.completedAt ?? null),
			}));
		}

		return serialized as IncidentWithRelations;
	}
}
