// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Alert } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	ALERT_CORRELATED_EVENT,
	type AlertCorrelatedEvent,
} from "../../shared/events/investigation-events.js";
import { IncidentsService } from "../incidents/incidents.service.js";

export interface IncidentCorrelationResult {
	incidentId: string;
	incidentNumber: number;
	isNewIncident: boolean;
	reason: string;
	/** Set when the alert was already linked to `incidentId`. */
	alreadyCorrelated?: boolean;
}

/**
 * What the deferred correlation module (rule editor, suppression) was
 * replaced with (prismalens/prismalens#608, C5 on #337): one firing alert
 * becomes one incident, deduplicated by `Alert.fingerprint` against an
 * incident that is still open. No rule table, no suppression, no
 * configurability.
 */
@Injectable()
export class IncidentCorrelationService {
	private readonly logger = new Logger(IncidentCorrelationService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly incidentsService: IncidentsService,
		private readonly eventEmitter: EventEmitter2,
	) {}

	/**
	 * Correlate an alert to an incident: reuse the open incident whose fingerprint
	 * already matches, otherwise open a new one. Emits `ALERT_CORRELATED_EVENT`
	 * (consumed by investigation auto-trigger) whenever the alert lands on an
	 * incident for the first time.
	 */
	async correlateAlert(alert: Alert): Promise<IncidentCorrelationResult> {
		const result = await this.runCorrelation(alert);
		if (!result.alreadyCorrelated) {
			const payload: AlertCorrelatedEvent = {
				alertId: alert.id,
				incidentId: result.incidentId,
				isNewIncident: result.isNewIncident,
			};
			this.eventEmitter.emit(ALERT_CORRELATED_EVENT, payload);
		}
		return result;
	}

	private async runCorrelation(
		alert: Alert,
	): Promise<IncidentCorrelationResult> {
		if (alert.incidentId) {
			const existing = await this.prisma.incident.findUnique({
				where: { id: alert.incidentId },
			});
			if (existing) {
				return {
					incidentId: existing.id,
					incidentNumber: existing.number,
					isNewIncident: false,
					reason: "Already correlated to incident",
					alreadyCorrelated: true,
				};
			}
		}

		if (alert.fingerprint) {
			const openMatch = await this.prisma.alert.findFirst({
				where: {
					fingerprint: alert.fingerprint,
					id: { not: alert.id },
					incidentId: { not: null },
					incident: { status: { notIn: ["resolved", "closed"] } },
				},
				include: { incident: true },
				orderBy: { triggeredAt: "desc" },
			});

			if (openMatch?.incident) {
				await this.incidentsService.addAlert(openMatch.incident.id, alert.id);
				this.logger.log(
					`Alert ${alert.id} matched fingerprint on open incident ${openMatch.incident.id}`,
				);
				return {
					incidentId: openMatch.incident.id,
					incidentNumber: openMatch.incident.number,
					isNewIncident: false,
					reason: "Matched by alert fingerprint",
				};
			}
		}

		const incident = await this.incidentsService.create({
			title: alert.title,
			description: alert.description ?? undefined,
			severity: alert.severity as
				| "critical"
				| "high"
				| "medium"
				| "low"
				| "info",
			serviceId: alert.serviceId ?? undefined,
			correlationReason: "New alert - no matching open incident",
		});
		await this.incidentsService.addAlert(incident.id, alert.id);

		return {
			incidentId: incident.id,
			incidentNumber: incident.number,
			isNewIncident: true,
			reason: "Created new incident",
		};
	}

	/**
	 * Resolve the incident once no alert linked to it is still firing —
	 * "firing" meaning any status other than `resolved`/`suppressed`. Called
	 * after a delivery resolves one of the incident's alerts (#593); a no-op
	 * while any other alert on the incident is still open.
	 */
	async resolveIncidentIfNoFiringAlerts(incidentId: string): Promise<void> {
		const firing = await this.prisma.alert.count({
			where: { incidentId, status: { notIn: ["resolved", "suppressed"] } },
		});
		if (firing === 0) {
			await this.incidentsService.resolve(incidentId);
			this.logger.log(
				`Resolved incident ${incidentId}: no firing alerts remain`,
			);
		}
	}
}
