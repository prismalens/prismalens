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
import { LlmSettingsService } from "../../core/settings/llm-settings.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { InvestigationsService } from "../investigations/investigations.service.js";
import type { CreateIncidentDto, UpdateIncidentDto } from "./dto/index.js";
import { IncidentsService } from "./incidents.service.js";

@Controller()
export class IncidentsController {
	constructor(
		private readonly incidentsService: IncidentsService,
		private readonly investigationsService: InvestigationsService,
		private readonly dispatchService: DispatchService,
		private readonly integrationsService: IntegrationsService,
		private readonly llmSettingsService: LlmSettingsService,
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

					// Refuse unrunnable investigations before modifying status (#520, ADR-0031).
					const selection = await this.llmSettingsService.resolveSelection();
					if (!selection.runnable) {
						throw new ORPCError("PRECONDITION_FAILED", {
							message: selection.reason,
							data: {
								failure: selection.failure,
								reason: selection.reason,
								harness: selection.harness,
							},
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

					// Fetch integrations and extract connectionIds for the job payload.
					// Only connectionIds are persisted — the run fetches credentials on-demand.
					const integrations =
						await this.integrationsService.getIntegrationsForService(
							incident.serviceId ?? undefined,
						);
					const connectionIds = integrations.map((i) => i.connectionId);

					// Enqueue the investigation job
					const jobId = await this.dispatchService.addInvestigationJob({
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

	private serializeAlert(alert: PrismaAlert | Record<string, unknown>): Alert {
		// Explicit whitelist — never spread the raw Prisma row. The `tenantId` column
		// (ADR-0011 §6 dormant multi-tenancy hedge) and any future internal columns
		// must stay out of the API response. oRPC output validation strips unknowns,
		// but defense-in-depth applies.
		const a = alert as Record<string, unknown>;
		return {
			id: a.id as string,
			dedupKey: a.dedupKey as string,
			fingerprint: (a.fingerprint as string) ?? null,
			externalId: (a.externalId as string) ?? null,
			title: a.title as string,
			description: (a.description as string) ?? null,
			severity: a.severity as Alert["severity"],
			status: a.status as Alert["status"],
			source: (a.source as string) ?? null,
			sourceUrl: (a.sourceUrl as string) ?? null,
			serviceId: (a.serviceId as string) ?? null,
			incidentId: (a.incidentId as string) ?? null,
			rawPayload: (a.rawPayload as string) ?? null,
			tags: a.tags
				? typeof a.tags === "string"
					? JSON.parse(a.tags)
					: a.tags
				: null,
			labels: a.labels
				? typeof a.labels === "string"
					? JSON.parse(a.labels)
					: a.labels
				: null,
			occurrenceCount: a.occurrenceCount as number,
			triggeredAt:
				a.triggeredAt instanceof Date
					? a.triggeredAt.toISOString()
					: (a.triggeredAt as string),
			acknowledgedAt:
				a.acknowledgedAt instanceof Date
					? a.acknowledgedAt.toISOString()
					: ((a.acknowledgedAt as string) ?? null),
			resolvedAt:
				a.resolvedAt instanceof Date
					? a.resolvedAt.toISOString()
					: ((a.resolvedAt as string) ?? null),
			lastOccurrence:
				a.lastOccurrence instanceof Date
					? a.lastOccurrence.toISOString()
					: (a.lastOccurrence as string),
			createdAt:
				a.createdAt instanceof Date
					? a.createdAt.toISOString()
					: (a.createdAt as string),
			updatedAt:
				a.updatedAt instanceof Date
					? a.updatedAt.toISOString()
					: (a.updatedAt as string),
		} as Alert;
	}

	private serializeIncidentWithRelations(
		incident: Record<string, unknown>,
	): IncidentWithRelations {
		const serialized = this.serializeIncident(
			incident as unknown as PrismaIncident,
		) as unknown as IncidentWithRelations;

		if (incident.service) {
			const svc = incident.service as Record<string, unknown>;
			serialized.service = {
				id: svc.id as string,
				name: svc.name as string,
				type:
					(svc.type as
						| "database"
						| "external"
						| "service"
						| "infrastructure"
						| "queue"
						| "cache"
						| "gateway") ?? "service",
				tier:
					(svc.tier as "tier_1" | "tier_2" | "tier_3" | "tier_4") ?? "tier_3",
				displayName: (svc.displayName as string) ?? null,
				description: (svc.description as string) ?? null,
				team: (svc.team as string) ?? null,
				slackChannel: (svc.slackChannel as string) ?? null,
				localCheckoutPath: (svc.localCheckoutPath as string) ?? null,
				tags: svc.tags
					? typeof svc.tags === "string"
						? JSON.parse(svc.tags)
						: (svc.tags as string[])
					: null,
				metadata: svc.metadata
					? typeof svc.metadata === "string"
						? JSON.parse(svc.metadata)
						: (svc.metadata as Record<string, unknown>)
					: null,
				createdAt:
					svc.createdAt instanceof Date
						? svc.createdAt.toISOString()
						: (svc.createdAt as string),
				updatedAt:
					svc.updatedAt instanceof Date
						? svc.updatedAt.toISOString()
						: (svc.updatedAt as string),
			};
		}

		if (incident.alerts && Array.isArray(incident.alerts)) {
			serialized.alerts = incident.alerts.map((a: Record<string, unknown>) =>
				this.serializeAlert(a),
			);
		}

		if (incident.investigations && Array.isArray(incident.investigations)) {
			serialized.investigations = incident.investigations.map(
				(i: Record<string, unknown>) => ({
					id: i.id as string,
					status: i.status as string,
					rootCause: (i.rootCause as string) ?? null,
					createdAt:
						i.createdAt instanceof Date
							? i.createdAt.toISOString()
							: (i.createdAt as string),
					completedAt:
						i.completedAt instanceof Date
							? i.completedAt.toISOString()
							: ((i.completedAt as string) ?? null),
				}),
			);
		}

		return serialized;
	}
}
