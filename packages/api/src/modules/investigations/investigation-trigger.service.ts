// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation Trigger Service
 *
 * Handles automatic investigation triggers based on:
 * - Severity (critical alerts)
 * - Service tier (P1 services)
 * - Alert threshold (X alerts within Y minutes)
 * - Scheduled checks (incidents open > Z hours)
 * - Re-trigger on new alerts
 *
 * Based on BigPanda pattern: proactive investigation for critical incidents
 */

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
	DEFAULT_TRIGGER_POLICY,
	type TriggerPolicy,
	TriggerPolicySchema,
	toFiringAlert,
} from "@prismalens/contracts";
import type { Alert, Incident, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import {
	ALERT_CORRELATED_EVENT,
	type AlertCorrelatedEvent,
} from "../../shared/events/investigation-events.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { InvestigationsService } from "./investigations.service.js";

/**
 * Trigger decision result
 */
export interface TriggerDecision {
	shouldTrigger: boolean;
	triggerType:
		| "manual"
		| "auto_critical"
		| "auto_tier"
		| "alert_threshold"
		| "scheduled"
		| "re_trigger"
		| null;
	reason: string | null;
}

export const NO_SERVICE_REASON =
	"The incident has no service, so there is no repository to investigate. Alerts reach a service through a `service` label whose value is the service's name; add it to the alert, or pick the service on the incident and press Investigate.";

/** The service's own policy from `metadata.investigation.trigger`; the default when absent or invalid. */
export function readTriggerPolicy(metadata: string | null): TriggerPolicy {
	if (!metadata) return DEFAULT_TRIGGER_POLICY;
	try {
		const parsed = JSON.parse(metadata) as {
			investigation?: { trigger?: unknown };
		};
		const result = TriggerPolicySchema.safeParse(
			parsed?.investigation?.trigger,
		);
		return result.success ? result.data : DEFAULT_TRIGGER_POLICY;
	} catch {
		return DEFAULT_TRIGGER_POLICY;
	}
}

const SEVERITIES_FOR_POLICY: Record<
	Exclude<TriggerPolicy, "always" | "never">,
	readonly string[]
> = {
	critical_and_high: ["critical", "high"],
	critical_only: ["critical"],
};

@Injectable()
export class InvestigationTriggerService {
	private readonly logger = new Logger(InvestigationTriggerService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatchService: DispatchService,
		private readonly integrationsService: IntegrationsService,
		@Inject(forwardRef(() => TimelineService))
		private readonly timelineService: TimelineService,
		private readonly investigationsService: InvestigationsService,
	) {}

	/**
	 * Whether an alert landing on this incident starts an investigation, by the
	 * service's own policy. No service means no repository, so never.
	 */
	async shouldTriggerInvestigation(
		incident: Incident & { service?: Service | null },
	): Promise<TriggerDecision> {
		if (!incident.service) {
			return {
				shouldTrigger: false,
				triggerType: null,
				reason: NO_SERVICE_REASON,
			};
		}
		const policy = readTriggerPolicy(incident.service.metadata);
		if (policy === "never") {
			return {
				shouldTrigger: false,
				triggerType: null,
				reason: `Auto-investigation is off for ${incident.service.name}. Change it on the ${incident.service.name} service's Investigation tab (open the service from this incident), or press Investigate on this incident.`,
			};
		}

		const existingInvestigation = await this.prisma.investigation.findFirst({
			where: {
				incidentId: incident.id,
				status: { in: ["pending", "running"] },
			},
		});
		if (existingInvestigation) {
			return {
				shouldTrigger: false,
				triggerType: null,
				reason: "Investigation already in progress",
			};
		}

		if (policy === "always") {
			return {
				shouldTrigger: true,
				triggerType: "auto_tier",
				reason: "Auto-investigation policy: always",
			};
		}
		if (SEVERITIES_FOR_POLICY[policy].includes(incident.severity)) {
			return {
				shouldTrigger: true,
				triggerType: "auto_critical",
				reason: `Auto-investigation policy: ${policy}, incident severity ${incident.severity}`,
			};
		}
		return {
			shouldTrigger: false,
			triggerType: null,
			reason: `Incident severity ${incident.severity} is below the policy of ${incident.service.name} (${policy.replace(/_/g, " ")}). Change it on the ${incident.service.name} service's Investigation tab (open the service from this incident), or press Investigate on this incident.`,
		};
	}

	@OnEvent(ALERT_CORRELATED_EVENT)
	async handleAlertCorrelated(event: AlertCorrelatedEvent): Promise<void> {
		const [alert, incident] = await Promise.all([
			this.prisma.alert.findUnique({ where: { id: event.alertId } }),
			this.prisma.incident.findUnique({
				where: { id: event.incidentId },
				include: { service: true },
			}),
		]);
		if (!alert || !incident) {
			this.logger.warn(
				`alert.correlated: alert ${event.alertId} or incident ${event.incidentId} not found`,
			);
			return;
		}
		await this.onAlertCorrelated(alert, incident, event.isNewIncident);
	}

	/**
	 * The auto-investigation decision for an alert that just landed on an
	 * incident. Only the alert that opened the incident decides; a later alert
	 * correlated into an open incident never starts a second run (re-running
	 * on new evidence is the 0.6 storm work). When the decision is no, the
	 * incident's timeline says why and where to change it.
	 */
	async onAlertCorrelated(
		alert: Alert,
		incident: Incident & { service?: Service | null },
		isNewIncident: boolean,
	): Promise<void> {
		if (!isNewIncident) {
			this.logger.debug(
				`Alert ${alert.id} joined open incident ${incident.number}; auto-investigation decides on the opening alert only`,
			);
			return;
		}

		const decision = await this.shouldTriggerInvestigation(incident);

		if (!decision.shouldTrigger) {
			this.logger.log(
				`No auto-investigation for incident ${incident.number}: ${decision.reason}`,
			);
			await this.timelineService.create({
				incidentId: incident.id,
				type: TimelineEntryType.custom,
				title:
					decision.reason === NO_SERVICE_REASON
						? "Auto-investigation skipped: no service"
						: "Auto-investigation skipped",
				description: decision.reason ?? "",
				source: TimelineSource.system,
				metadata: {},
			});
			return;
		}

		this.logger.log(
			`Auto-triggering investigation for incident ${incident.number}: ${decision.reason}`,
		);

		await this.triggerInvestigation(incident, decision);
	}

	/**
	 * Trigger an investigation for an incident
	 */
	async triggerInvestigation(
		incident: Incident & { service?: Service | null },
		decision: TriggerDecision,
	): Promise<void> {
		const { investigation, created } =
			await this.investigationsService.startOrGet({
				incidentId: incident.id,
				...(decision.triggerType ? { triggerType: decision.triggerType } : {}),
				...(decision.reason ? { triggerReason: decision.reason } : {}),
			});
		if (!created) {
			this.logger.log(
				`Incident ${incident.number} already has investigation ${investigation.id} in progress; not triggering another`,
			);
			return;
		}

		let jobId: string | null;
		try {
			// Resolve connectionIds for the run (only ids go in the job payload; the run fetches creds on-demand).
			// Without a serviceId we can't scope integrations to this incident's service,
			// so send no connectionIds rather than every active integration.
			const connectionIds = incident.serviceId
				? (
						await this.integrationsService.getIntegrationsForService(
							incident.serviceId,
						)
					).map((i) => i.connectionId)
				: [];

			// Fetch the incident's alerts so the job payload matches the manual
			// trigger path (follow-up 4a, issue #302 — no silent divergence).
			const incidentAlerts = await this.prisma.alert.findMany({
				where: { incidentId: incident.id },
				orderBy: { triggeredAt: "desc" },
			});

			jobId = await this.dispatchService.addInvestigationJob({
				incidentId: incident.id,
				investigationId: investigation.id,
				priority: this.mapSeverityToPriority(incident.severity),
				context: {
					title: incident.title,
					severity: incident.severity,
					alertCount: incident.alertCount,
					serviceName: incident.service?.name,
				},
				connectionIds,
				alerts:
					incidentAlerts.length > 0
						? incidentAlerts.map((a) => toFiringAlert(a))
						: undefined,
			});
		} catch (error) {
			// AC: no dangling pending rows — @OnEvent swallows listener errors, so a throw
			// in the resolve/enqueue path would otherwise leave the row 'pending' forever.
			const message = error instanceof Error ? error.message : String(error);
			await this.prisma.investigation.update({
				where: { id: investigation.id },
				data: {
					status: "failed",
					error: `Failed to trigger investigation: ${message}`,
				},
			});
			await this.timelineService.create({
				incidentId: incident.id,
				type: TimelineEntryType.custom,
				title: "Auto-investigation failed",
				description:
					"The investigation could not be triggered due to an unexpected error.",
				source: TimelineSource.system,
				metadata: {
					investigationId: investigation.id,
					triggerReason: decision.reason,
				},
			});
			this.logger.warn(
				`Trigger failed for investigation ${investigation.id}: ${message}`,
			);
			return;
		}

		if (jobId === null) {
			// AC: no dangling pending rows — mark failed + timeline entry.
			await this.prisma.investigation.update({
				where: { id: investigation.id },
				data: {
					status: "failed",
					error: "Failed to enqueue investigation job (queue unavailable)",
				},
			});
			await this.timelineService.create({
				incidentId: incident.id,
				type: TimelineEntryType.custom,
				title: "Auto-investigation enqueue failed",
				description:
					"The investigation could not be queued (queue unavailable).",
				source: TimelineSource.system,
				metadata: {
					investigationId: investigation.id,
					triggerReason: decision.reason,
				},
			});
			this.logger.warn(
				`Enqueue failed for investigation ${investigation.id}; marked failed`,
			);
			return;
		}

		this.logger.log(
			`Enqueued auto-investigation ${investigation.id} (job ${jobId}) for incident ${incident.number}`,
		);
	}

	private mapSeverityToPriority(
		severity: string,
	): "low" | "normal" | "high" | "critical" {
		switch (severity) {
			case "critical":
				return "critical";
			case "high":
				return "high";
			case "low":
			case "info":
				return "low";
			default:
				return "normal";
		}
	}
}
