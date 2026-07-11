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
import type { Alert, Incident, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { SettingsService } from "../../core/settings/settings.service.js";
import { QueueService } from "../../infrastructure/queue/queue.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import {
	ALERT_CORRELATED_EVENT,
	type AlertCorrelatedEvent,
} from "../../shared/events/investigation-events.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { TimelineService } from "../timeline/timeline.service.js";

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
	delay?: number; // Delay in milliseconds before triggering
}

/**
 * Investigation trigger configuration (per tier)
 */
export interface TriggerConfig {
	tier: string;
	autoInvestigate: "always" | "critical_high" | "manual" | "never";
	triggerOnAlertCount: number;
	triggerOnSeverities: ("critical" | "high")[];
	triggerDelayMinutes: number;
	reInvestigateOnNewAlerts: boolean;
	reInvestigateThreshold: number;
}

/**
 * Default trigger configurations by tier
 */
const DEFAULT_TRIGGER_CONFIGS: Record<string, TriggerConfig> = {
	tier_1: {
		tier: "tier_1",
		autoInvestigate: "critical_high",
		triggerOnAlertCount: 3,
		triggerOnSeverities: ["critical", "high"],
		triggerDelayMinutes: 2,
		reInvestigateOnNewAlerts: true,
		reInvestigateThreshold: 3,
	},
	tier_2: {
		tier: "tier_2",
		autoInvestigate: "critical_high",
		triggerOnAlertCount: 5,
		triggerOnSeverities: ["critical"],
		triggerDelayMinutes: 5,
		reInvestigateOnNewAlerts: false,
		reInvestigateThreshold: 5,
	},
	tier_3: {
		tier: "tier_3",
		autoInvestigate: "manual",
		triggerOnAlertCount: 10,
		triggerOnSeverities: ["critical"],
		triggerDelayMinutes: 10,
		reInvestigateOnNewAlerts: false,
		reInvestigateThreshold: 10,
	},
	tier_4: {
		tier: "tier_4",
		autoInvestigate: "never",
		triggerOnAlertCount: 20,
		triggerOnSeverities: [],
		triggerDelayMinutes: 15,
		reInvestigateOnNewAlerts: false,
		reInvestigateThreshold: 20,
	},
};

@Injectable()
export class InvestigationTriggerService {
	private readonly logger = new Logger(InvestigationTriggerService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly settingsService: SettingsService,
		private readonly queueService: QueueService,
		private readonly integrationsService: IntegrationsService,
		@Inject(forwardRef(() => TimelineService))
		private readonly timelineService: TimelineService,
	) {}

	/**
	 * Get trigger configuration for a service tier
	 */
	async getTriggerConfig(tier: string): Promise<TriggerConfig> {
		const { policies } = await this.settingsService.getInvestigationPolicies();
		const policy = policies.find((p) => p.tier === tier);
		if (!policy) {
			return DEFAULT_TRIGGER_CONFIGS[tier] ?? DEFAULT_TRIGGER_CONFIGS.tier_3;
		}
		const fallback =
			DEFAULT_TRIGGER_CONFIGS[tier] ?? DEFAULT_TRIGGER_CONFIGS.tier_3;
		return {
			tier: policy.tier,
			autoInvestigate: policy.autoInvestigate,
			triggerOnAlertCount:
				policy.triggerOnAlertCount ?? fallback.triggerOnAlertCount,
			triggerOnSeverities:
				policy.triggerOnSeverities ?? fallback.triggerOnSeverities,
			triggerDelayMinutes:
				policy.triggerDelayMinutes ?? fallback.triggerDelayMinutes,
			reInvestigateOnNewAlerts:
				policy.reInvestigateOnNewAlerts ?? fallback.reInvestigateOnNewAlerts,
			reInvestigateThreshold:
				policy.reInvestigateThreshold ?? fallback.reInvestigateThreshold,
		};
	}

	/**
	 * Determine if an investigation should be triggered for an incident
	 */
	async shouldTriggerInvestigation(
		incident: Incident & { service?: Service | null },
	): Promise<TriggerDecision> {
		const serviceTier = incident.service?.tier || "tier_3";
		const config = await this.getTriggerConfig(serviceTier);

		// Check if auto-investigation is disabled
		if (config.autoInvestigate === "never") {
			return {
				shouldTrigger: false,
				triggerType: null,
				reason: "Auto-investigation disabled for this tier",
			};
		}

		// Check if investigation already running
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

		// Check severity-based trigger
		if (config.autoInvestigate === "always") {
			return {
				shouldTrigger: true,
				triggerType: "auto_tier",
				reason: `Auto-investigation enabled for ${serviceTier}`,
				delay: config.triggerDelayMinutes * 60 * 1000,
			};
		}

		if (config.autoInvestigate === "critical_high") {
			const severity = incident.severity as
				| "critical"
				| "high"
				| "medium"
				| "low"
				| "info";
			if (
				config.triggerOnSeverities.includes(severity as "critical" | "high")
			) {
				return {
					shouldTrigger: true,
					triggerType: "auto_critical",
					reason: `Auto-triggered for ${severity} severity incident on ${serviceTier} service`,
					delay: config.triggerDelayMinutes * 60 * 1000,
				};
			}
		}

		// Check alert count threshold
		if (incident.alertCount >= config.triggerOnAlertCount) {
			return {
				shouldTrigger: true,
				triggerType: "alert_threshold",
				reason: `Alert count (${incident.alertCount}) reached threshold (${config.triggerOnAlertCount})`,
				delay: config.triggerDelayMinutes * 60 * 1000,
			};
		}

		return {
			shouldTrigger: false,
			triggerType: null,
			reason: "No trigger conditions met",
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
		await this.onAlertCorrelated(alert, incident);
	}

	/**
	 * Called when an alert is correlated to an incident
	 * Determines if this correlation should trigger an investigation
	 */
	async onAlertCorrelated(
		alert: Alert,
		incident: Incident & { service?: Service | null },
	): Promise<void> {
		this.logger.debug(
			`Alert ${alert.id} correlated to incident ${incident.number}`,
		);

		const decision = await this.shouldTriggerInvestigation(incident);

		if (!decision.shouldTrigger) {
			this.logger.debug(
				`No auto-investigation for incident ${incident.number}: ${decision.reason}`,
			);
			return;
		}

		this.logger.log(
			`Auto-triggering investigation for incident ${incident.number}: ${decision.reason}`,
		);

		await this.triggerInvestigation(incident, decision);
	}

	/**
	 * Check if a completed investigation should be re-triggered due to new alerts
	 */
	async shouldReInvestigate(
		incident: Incident & { service?: Service | null },
		newAlertCount: number,
	): Promise<TriggerDecision> {
		const serviceTier = incident.service?.tier || "tier_3";
		const config = await this.getTriggerConfig(serviceTier);

		if (!config.reInvestigateOnNewAlerts) {
			return {
				shouldTrigger: false,
				triggerType: null,
				reason: "Re-investigation disabled for this tier",
			};
		}

		// Check if there's a completed investigation
		const lastInvestigation = await this.prisma.investigation.findFirst({
			where: {
				incidentId: incident.id,
				status: "completed",
			},
			orderBy: { completedAt: "desc" },
		});

		if (!lastInvestigation) {
			return {
				shouldTrigger: false,
				triggerType: null,
				reason: "No completed investigation found",
			};
		}

		// Count alerts added since investigation completed
		const alertsSinceCompletion = await this.prisma.alert.count({
			where: {
				incidentId: incident.id,
				createdAt: { gt: lastInvestigation.completedAt! },
			},
		});

		if (alertsSinceCompletion >= config.reInvestigateThreshold) {
			return {
				shouldTrigger: true,
				triggerType: "re_trigger",
				reason: `${alertsSinceCompletion} new alerts since last investigation (threshold: ${config.reInvestigateThreshold})`,
			};
		}

		return {
			shouldTrigger: false,
			triggerType: null,
			reason: `Not enough new alerts (${alertsSinceCompletion}/${config.reInvestigateThreshold})`,
		};
	}

	/**
	 * Schedule a delayed trigger check (allows more alerts to correlate)
	 */
	async scheduleDelayedTriggerCheck(
		incident: Incident,
		delayMs: number,
	): Promise<void> {
		// TODO: Use BullMQ to schedule the job when worker is available
		// For now, log the intent
		this.logger.debug(
			`Would schedule trigger check for incident ${incident.number} in ${delayMs}ms`,
		);

		// In a real implementation, this would:
		// await this.queueService.addDelayedJob('check-investigation-trigger', {
		//   incidentId: incident.id,
		// }, { delay: delayMs });
	}

	/**
	 * Trigger an investigation for an incident
	 */
	async triggerInvestigation(
		incident: Incident & { service?: Service | null },
		decision: TriggerDecision,
	): Promise<void> {
		// Create investigation record with trigger info
		const investigation = await this.prisma.investigation.create({
			data: {
				incidentId: incident.id,
				status: "pending",
				triggerType: decision.triggerType,
				triggerReason: decision.reason,
			},
		});

		let jobId: string | null;
		try {
			// Resolve connectionIds for the worker (only ids go to Redis; worker fetches creds on-demand).
			// Without a serviceId we can't scope integrations to this incident's service,
			// so send no connectionIds rather than every active integration.
			const connectionIds = incident.serviceId
				? (
						await this.integrationsService.getIntegrationsForService(
							incident.serviceId,
						)
					).map((i) => i.connectionId)
				: [];

			jobId = await this.queueService.addInvestigationJob({
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
