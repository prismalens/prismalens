// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, forwardRef, Inject } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { alertsContract } from "@prismalens/contracts";
import type {
	Alert,
	AlertDetail,
	AlertWithRelations,
	SuppressedByRuleConflict,
} from "@prismalens/contracts/schemas";
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
				const finalAlert =
					(await this.alertsService.findById(alert.id)) ?? alert;

				return {
					alert: this.serializeAlert(finalAlert),
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
				const { data, total } = await this.alertsService.findAll({
					status: input.status,
					severity: input.severity,
					serviceId: input.serviceId,
					incidentId: input.incidentId,
					hasIncident: input.hasIncident,
					limit: input.limit,
					offset: input.offset,
				});
				const limit = input.limit;
				const offset = input.offset;
				return {
					data: data.map((a) => this.serializeAlertWithRelations(a)),
					pagination: {
						total,
						limit,
						offset,
						hasMore: offset + data.length < total,
					},
				};
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
				return {
					...this.serializeAlertWithRelations(alert),
					suppressedBy: await this.resolveSuppressedBy(alert),
				} as AlertDetail;
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

					// The waterfall ran and a rule suppressed the alert. Answering 200
					// with no incident here is the dead end from #312: the caller asked
					// to correlate, nothing correlated, and nothing said why. Refuse
					// loudly and name the rule instead. We do not offer a bypass — the
					// rule is the source of truth, so "suppressed by rule X" is still
					// true after this call. The way out is to disable the rule or amend
					// its match criteria (PATCH /correlation/rules/:id) and try again.
					if (result.suppressed) {
						// Rule-based suppression always names its rule, so this is the
						// path every real refusal takes.
						if (result.ruleId && result.ruleName) {
							throw new ORPCError("CONFLICT", {
								message:
									`Alert ${input.id} cannot be correlated: correlation rule ` +
									`"${result.ruleName}" (${result.ruleId}) is enabled and suppresses it. ` +
									`Disable that rule or amend its match criteria via ` +
									`PATCH /correlation/rules/${result.ruleId}, then correlate again.`,
								data: {
									alertId: input.id,
									ruleId: result.ruleId,
									ruleName: result.ruleName,
								} satisfies SuppressedByRuleConflict,
							});
						}

						// Attribution missing. Still refuse: returning the 200-with-no-
						// incident response here would restore exactly the dead end this
						// endpoint exists to close.
						throw new ORPCError("CONFLICT", {
							message:
								`Alert ${input.id} cannot be correlated: an enabled ` +
								`correlation rule suppresses it.`,
						});
					}

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
	 * Answer "which enabled rule is holding this alert down right now?" for a
	 * single-alert read.
	 *
	 * Only suppressed alerts can be blocked, so anything else short-circuits
	 * without touching the rule set. The answer is derived, never stored — see
	 * CorrelationService.findSuppressingRule.
	 */
	private async resolveSuppressedBy(
		alert: PrismaAlert,
	): Promise<AlertDetail["suppressedBy"]> {
		if (alert.status !== "suppressed") {
			return null;
		}

		const rule = await this.correlationService.findSuppressingRule(alert);
		return rule ? { ruleId: rule.id, ruleName: rule.name } : null;
	}

	/**
	 * Serialize alert for API response
	 * Converts Date objects to ISO strings
	 */
	private serializeAlert(alert: PrismaAlert): Alert {
		return {
			...alert,
			fingerprint: alert.fingerprint ?? null,
			externalId: alert.externalId ?? null,
			source: alert.source ?? null,
			sourceUrl: alert.sourceUrl ?? null,
			rawPayload: alert.rawPayload ?? null,
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
				displayName: alert.service.displayName ?? null,
				description: alert.service.description ?? null,
				team: alert.service.team ?? null,
				slackChannel: alert.service.slackChannel ?? null,
				tags: alert.service.tags ? JSON.parse(alert.service.tags) : null,
				metadata: alert.service.metadata
					? JSON.parse(alert.service.metadata)
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
