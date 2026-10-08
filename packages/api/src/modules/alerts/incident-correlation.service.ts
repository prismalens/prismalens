// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
	ENDED_INCIDENT_STATUSES,
	OPEN_ALERT_STATUSES,
	OPEN_INCIDENT_STATUSES,
} from "@prismalens/contracts";
import type { Alert } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	ALERT_CORRELATED_EVENT,
	type AlertCorrelatedEvent,
} from "../../shared/events/investigation-events.js";
import {
	IncidentsService,
	type StatusNote,
} from "../incidents/incidents.service.js";

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
	 *
	 * `autoInvestigate: false` correlates exactly as normal but withholds that
	 * event, so the alert and its incident are recorded and nothing is
	 * dispatched. The one caller is a Prometheus firing whose resolution has
	 * already arrived (#664 review): the alert row has to exist for the resolve
	 * path to find it, but starting a harness run for an episode that is already
	 * over is pure waste — the run is never cancelled, it completes and is
	 * resolved microseconds later.
	 */
	async correlateAlert(
		alert: Alert,
		options: { autoInvestigate?: boolean; reopened?: boolean } = {},
	): Promise<IncidentCorrelationResult> {
		const result = await this.runCorrelation(alert);
		const reopened =
			result.alreadyCorrelated === true && options.reopened === true;
		if (
			(!result.alreadyCorrelated || reopened) &&
			options.autoInvestigate !== false
		) {
			const payload: AlertCorrelatedEvent = {
				alertId: alert.id,
				incidentId: result.incidentId,
				isNewIncident: result.isNewIncident,
				...(reopened && { reopened: true }),
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
			// The fingerprint carries the alert's `service` label, so two services
			// in one grouped delivery never share one (#633 edge 12). The service
			// scope below still narrows, never widens: an alert with no registered
			// service matches only an incident with none.
			const openMatch = await this.prisma.alert.findFirst({
				where: {
					fingerprint: alert.fingerprint,
					id: { not: alert.id },
					incidentId: { not: null },
					incident: {
						status: { in: [...OPEN_INCIDENT_STATUSES] },
						serviceId: alert.serviceId ?? null,
					},
				},
				include: { incident: true },
				orderBy: { triggeredAt: "desc" },
			});

			if (openMatch?.incident) {
				await this.incidentsService.addAlert(openMatch.incident.id, alert.id);
				this.logger.log(
					`Alert ${alert.id} matched the label set of open incident ${openMatch.incident.id}`,
				);
				return {
					incidentId: openMatch.incident.id,
					incidentNumber: openMatch.incident.number,
					isNewIncident: false,
					reason: alert.serviceId
						? "Matched by alert fingerprint on the same service"
						: "Matched by alert fingerprint",
				};
			}
		}

		// The same alert's last incident, when it ended: the new one names it
		// so a refire after Close reads as a second outage, not a swallowed one (walk f32).
		// dedupKey first: the fingerprint hashes the description, which can change
		// (#673 w43), and a shared fingerprint must not pick another alert's incident.
		const identity = [
			...(alert.dedupKey ? [{ dedupKey: alert.dedupKey }] : []),
			...(alert.fingerprint ? [{ fingerprint: alert.fingerprint }] : []),
		];
		const endedMatch = (match: (typeof identity)[number]) =>
			this.prisma.alert.findFirst({
				where: {
					...match,
					id: { not: alert.id },
					incidentId: { not: null },
					incident: {
						status: { in: [...ENDED_INCIDENT_STATUSES] },
						serviceId: alert.serviceId ?? null,
					},
				},
				include: { incident: true },
				orderBy: { triggeredAt: "desc" },
			});
		let prior: Awaited<ReturnType<typeof endedMatch>> = null;
		for (const match of identity) {
			prior = await endedMatch(match);
			if (prior) break;
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
			...(prior?.incident
				? {
						priorIncident: {
							id: prior.incident.id,
							number: prior.incident.number,
							status: prior.incident.status,
							endedAt: prior.incident.resolvedAt,
							alertName: alertName(alert),
						},
					}
				: {}),
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
	async resolveIncidentIfNoFiringAlerts(
		incidentId: string,
		note?: StatusNote,
	): Promise<void> {
		const firing = await this.prisma.alert.count({
			where: { incidentId, status: { in: [...OPEN_ALERT_STATUSES] } },
		});
		if (firing === 0) {
			await this.incidentsService.resolve(incidentId, note);
			this.logger.log(
				`Resolved incident ${incidentId}: no firing alerts remain`,
			);
		}
	}
}

/** The rule's name from the label set, else the alert's title. */
function alertName(alert: Alert): string {
	try {
		const labels: unknown = alert.labels ? JSON.parse(alert.labels) : null;
		if (labels && typeof labels === "object") {
			const name = (labels as Record<string, unknown>).alertname;
			if (typeof name === "string" && name) return name;
		}
	} catch {
		// an unreadable label set falls back to the title
	}
	return alert.title;
}
