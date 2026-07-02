import { Controller, forwardRef, Inject } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { alertsContract } from "@prismalens/contracts";
import type { Alert, AlertWithRelations } from "@prismalens/contracts/schemas";
import type { Alert as PrismaAlert } from "@prismalens/database";
import { CorrelationService } from "../correlation/correlation.service.js";
import { AlertsService } from "./alerts.service.js";
import type { CreateAlertDto, UpdateAlertDto } from "./dto/index.js";

@Controller()
export class AlertsController {
	constructor(
		private readonly alertsService: AlertsService,
		@Inject(forwardRef(() => CorrelationService))
		private readonly correlationService: CorrelationService,
	) {}

	/**
	 * Implement the entire alerts contract
	 * All endpoints are type-safe with input validation via Zod
	 */
	@Implement(alertsContract)
	alerts() {
		return {
			// POST /alerts - Create a new alert with auto-correlation
			create: implement(alertsContract.create).handler(async ({ input }) => {
				// Cast to DTO type - Zod validation ensures values are compatible
				const alert = await this.alertsService.create(input as CreateAlertDto);
				const correlationResult =
					await this.correlationService.correlateAlert(alert);

				return {
					alert: this.serializeAlert(alert),
					correlation: {
						incidentId: correlationResult.incidentId,
						incidentNumber: correlationResult.incidentNumber,
						reason: correlationResult.reason,
						isNewIncident: correlationResult.isNewIncident,
					},
				};
			}),

			// GET /alerts - List alerts with filtering
			list: implement(alertsContract.list).handler(async ({ input }) => {
				const alerts = await this.alertsService.findAll({
					status: input.status,
					severity: input.severity,
					serviceId: input.serviceId,
					incidentId: input.incidentId,
					hasIncident: input.hasIncident,
					limit: input.limit,
					offset: input.offset,
				});
				return alerts.map((a) => this.serializeAlertWithRelations(a));
			}),

			// GET /alerts/uncorrelated - List uncorrelated alerts
			listUncorrelated: implement(alertsContract.listUncorrelated).handler(
				async ({ input }) => {
					const alerts = await this.alertsService.findUncorrelated(input.limit);
					return alerts.map((a) => this.serializeAlert(a));
				},
			),

			// GET /alerts/stats - Get alert statistics
			getStats: implement(alertsContract.getStats).handler(async () => {
				return this.alertsService.getStats();
			}),

			// GET /alerts/:id - Get a single alert
			get: implement(alertsContract.get).handler(async ({ input }) => {
				const alert = await this.alertsService.findById(input.id);
				if (!alert) {
					throw new ORPCError("NOT_FOUND", {
						message: `Alert ${input.id} not found`,
					});
				}
				return this.serializeAlertWithRelations(alert);
			}),

			// PATCH /alerts/:id - Update an alert
			update: implement(alertsContract.update).handler(async ({ input }) => {
				const { id, ...updateData } = input;
				const alert = await this.alertsService.update(
					id,
					updateData as UpdateAlertDto,
				);
				if (!alert) {
					throw new ORPCError("NOT_FOUND", {
						message: `Alert ${id} not found`,
					});
				}
				return this.serializeAlert(alert);
			}),

			// POST /alerts/:id/acknowledge - Acknowledge an alert
			acknowledge: implement(alertsContract.acknowledge).handler(
				async ({ input }) => {
					const alert = await this.alertsService.acknowledge(input.id);
					if (!alert) {
						throw new ORPCError("NOT_FOUND", {
							message: `Alert ${input.id} not found`,
						});
					}
					return this.serializeAlert(alert);
				},
			),

			// POST /alerts/:id/resolve - Resolve an alert
			resolve: implement(alertsContract.resolve).handler(async ({ input }) => {
				const alert = await this.alertsService.resolve(input.id);
				if (!alert) {
					throw new ORPCError("NOT_FOUND", {
						message: `Alert ${input.id} not found`,
					});
				}
				return this.serializeAlert(alert);
			}),

			// POST /alerts/:id/correlate - Correlate an alert to an incident
			correlate: implement(alertsContract.correlate).handler(
				async ({ input }) => {
					const alert = await this.alertsService.findById(input.id);
					if (!alert) {
						throw new ORPCError("NOT_FOUND", {
							message: `Alert ${input.id} not found`,
						});
					}

					// Already correlated?
					if (alert.incidentId) {
						return {
							alert: this.serializeAlert(alert),
							incidentId: alert.incident?.id,
							incidentNumber: alert.incident?.number,
							reason: "Already correlated",
							isNewIncident: false,
						};
					}

					const result = await this.correlationService.correlateAlert(alert);
					const updatedAlert = await this.alertsService.findById(input.id);

					return {
						alert: this.serializeAlert(updatedAlert!),
						incidentId: result.incidentId,
						incidentNumber: result.incidentNumber,
						reason: result.reason,
						isNewIncident: result.isNewIncident,
					};
				},
			),

			// DELETE /alerts/:id - Delete an alert
			delete: implement(alertsContract.delete).handler(async ({ input }) => {
				const deleted = await this.alertsService.delete(input.id);
				if (!deleted) {
					throw new ORPCError("NOT_FOUND", {
						message: `Alert ${input.id} not found`,
					});
				}
				// Return void for DELETE
			}),
		};
	}

	/**
	 * Serialize alert for API response
	 * Converts Date objects to ISO strings
	 */
	private serializeAlert(alert: PrismaAlert): Alert {
		return {
			...alert,
			tags: alert.tags ? JSON.parse(alert.tags) : null,
			labels: alert.labels ? JSON.parse(alert.labels) : null,
			triggeredAt: alert.triggeredAt?.toISOString(),
			acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
			resolvedAt: alert.resolvedAt?.toISOString() ?? null,
			lastOccurrence: alert.lastOccurrence?.toISOString(),
			createdAt: alert.createdAt?.toISOString(),
			updatedAt: alert.updatedAt?.toISOString(),
		} as Alert;
	}

	/**
	 * Serialize alert with relations for API response
	 */
	private serializeAlertWithRelations(
		alert: Record<string, any>,
	): AlertWithRelations {
		const serialized = this.serializeAlert(alert as PrismaAlert) as any;

		if (alert.service) {
			serialized.service = {
				...alert.service,
				tags: alert.service.tags ? JSON.parse(alert.service.tags) : null,
				metadata: alert.service.metadata
					? JSON.parse(alert.service.metadata)
					: null,
				discoveryMetadata: alert.service.discoveryMetadata
					? JSON.parse(alert.service.discoveryMetadata)
					: null,
				createdAt: alert.service.createdAt?.toISOString(),
				updatedAt: alert.service.updatedAt?.toISOString(),
			};
		}

		if (alert.incident) {
			serialized.incident = {
				id: alert.incident.id,
				number: alert.incident.number,
				title: alert.incident.title,
				status: alert.incident.status,
				severity: alert.incident.severity,
			};
		}

		return serialized as AlertWithRelations;
	}
}
