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

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import type { Incident, Service, Alert } from "@prisma/client";

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

	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Get trigger configuration for a service tier
	 */
	async getTriggerConfig(tier: string): Promise<TriggerConfig> {
		// TODO: Load from settings table when investigation_triggers setting is implemented
		// For now, use default configs
		return DEFAULT_TRIGGER_CONFIGS[tier] || DEFAULT_TRIGGER_CONFIGS.tier_3;
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
			const severity = incident.severity as "critical" | "high" | "medium" | "low" | "info";
			if (config.triggerOnSeverities.includes(severity as "critical" | "high")) {
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

		if (decision.shouldTrigger) {
			this.logger.log(
				`Auto-triggering investigation for incident ${incident.number}: ${decision.reason}`,
			);

			// If there's a delay, schedule the trigger
			if (decision.delay && decision.delay > 0) {
				await this.scheduleDelayedTriggerCheck(incident, decision.delay);
			} else {
				// Trigger immediately
				await this.triggerInvestigation(incident, decision);
			}
		}
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
		incident: Incident,
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

		this.logger.log(
			`Created investigation ${investigation.id} for incident ${incident.number}`,
			{ triggerType: decision.triggerType, reason: decision.reason },
		);

		// TODO: Queue the investigation job
		// await this.queueService.addInvestigationJob({
		//   investigationId: investigation.id,
		//   incidentId: incident.id,
		// });
	}
}
