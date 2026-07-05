// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Investigation Update Service
 *
 * Handles new alerts arriving during an ongoing investigation.
 * Strategies for updating investigations based on new context.
 */

import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { Alert, Incident, Investigation } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { InvestigationTriggerService } from "./investigation-trigger.service.js";

/**
 * Update strategy for new alerts during investigation
 */
export enum UpdateStrategy {
	/** Don't notify - investigation proceeds */
	IGNORE = "ignore",
	/** Add to pendingAlerts for Commander awareness */
	NOTIFY = "notify",
	/** Queue partial re-analysis after completion */
	QUEUE_PARTIAL = "queue_partial",
	/** Cancel and restart investigation */
	RESTART = "restart",
}

/**
 * Event payload for alert added to incident
 */
export interface AlertAddedEvent {
	alertId: string;
	incidentId: string;
	alert: Alert;
	incident: Incident;
	previousAlertCount: number;
}

@Injectable()
export class InvestigationUpdateService {
	private readonly logger = new Logger(InvestigationUpdateService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly triggerService: InvestigationTriggerService,
	) {}

	/**
	 * Find active investigation for an incident
	 */
	async findActiveInvestigation(
		incidentId: string,
	): Promise<Investigation | null> {
		return this.prisma.investigation.findFirst({
			where: {
				incidentId,
				status: { in: ["pending", "running"] },
			},
		});
	}

	/**
	 * Determine update strategy based on alert characteristics
	 */
	async determineUpdateStrategy(
		investigation: Investigation,
		event: AlertAddedEvent,
	): Promise<UpdateStrategy> {
		const { alert, incident, previousAlertCount } = event;

		// If investigation is still pending, can add to initial context
		if (investigation.status === "pending") {
			return UpdateStrategy.IGNORE;
		}

		// If critical alert arrives during investigation, restart
		if (alert.severity === "critical" && incident.severity !== "critical") {
			this.logger.log(
				`Critical alert ${alert.id} arrived during investigation - recommending restart`,
			);
			return UpdateStrategy.RESTART;
		}

		// If alert count doubled, notify Commander
		const newAlertCount = incident.alertCount;
		if (newAlertCount >= previousAlertCount * 2) {
			this.logger.log(
				`Alert count doubled (${previousAlertCount} → ${newAlertCount}) - notifying Commander`,
			);
			return UpdateStrategy.NOTIFY;
		}

		// If many new alerts arrived quickly, queue partial update
		const recentAlerts = await this.prisma.alert.count({
			where: {
				incidentId: incident.id,
				createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) }, // Last 5 minutes
			},
		});

		if (recentAlerts >= 5) {
			this.logger.log(
				`${recentAlerts} alerts in last 5 minutes - queuing partial update`,
			);
			return UpdateStrategy.QUEUE_PARTIAL;
		}

		// Default: ignore
		return UpdateStrategy.IGNORE;
	}

	/**
	 * Handle alert added to incident event
	 */
	@OnEvent("incident.alertAdded")
	async handleAlertAdded(event: AlertAddedEvent): Promise<void> {
		this.logger.debug(
			`Alert ${event.alertId} added to incident ${event.incidentId}`,
		);

		// Check for active investigation
		const activeInvestigation = await this.findActiveInvestigation(
			event.incidentId,
		);

		if (!activeInvestigation) {
			// No active investigation - check if we should trigger one
			const incidentWithService = await this.prisma.incident.findUnique({
				where: { id: event.incidentId },
				include: { service: true },
			});

			if (incidentWithService) {
				await this.triggerService.onAlertCorrelated(
					event.alert,
					incidentWithService,
				);
			}
			return;
		}

		// Determine update strategy
		const strategy = await this.determineUpdateStrategy(
			activeInvestigation,
			event,
		);

		switch (strategy) {
			case UpdateStrategy.NOTIFY:
				await this.notifyInvestigation(activeInvestigation, event);
				break;

			case UpdateStrategy.QUEUE_PARTIAL:
				await this.queuePartialUpdate(activeInvestigation, event);
				break;

			case UpdateStrategy.RESTART:
				await this.restartInvestigation(activeInvestigation, event);
				break;

			case UpdateStrategy.IGNORE:
			default:
				this.logger.debug(
					`Ignoring alert ${event.alertId} for investigation ${activeInvestigation.id}`,
				);
				break;
		}
	}

	/**
	 * Notify investigation of new alerts.
	 */
	async notifyInvestigation(
		investigation: Investigation,
		event: AlertAddedEvent,
	): Promise<void> {
		this.logger.warn(
			`Investigation ${investigation.id} received alert ${event.alertId} ` +
				`(severity: ${event.alert.severity}) — notification not yet implemented (Phase 5C-2)`,
		);
		this.logger.debug(`Alert ${event.alertId} title: ${event.alert.title}`);
		// TODO(Phase-5C-2): When checkpoint persistence is implemented,
		// inject pendingAlerts into LangGraph checkpoint state.
	}

	/**
	 * Queue a partial update job after investigation completes
	 */
	async queuePartialUpdate(
		investigation: Investigation,
		event: AlertAddedEvent,
	): Promise<void> {
		this.logger.log(
			`Queuing partial update for investigation ${investigation.id}`,
		);

		// TODO: Use BullMQ to schedule partial update job
		// await this.queueService.addJob('partial-investigation-update', {
		//   investigationId: investigation.id,
		//   incidentId: event.incidentId,
		//   triggerAlertId: event.alertId,
		// });
	}

	/**
	 * Cancel and restart investigation with new context
	 */
	async restartInvestigation(
		investigation: Investigation,
		event: AlertAddedEvent,
	): Promise<void> {
		this.logger.log(`Restarting investigation ${investigation.id}`);

		// Mark current investigation as cancelled
		await this.prisma.investigation.update({
			where: { id: investigation.id },
			data: {
				status: "cancelled",
				error: `Cancelled due to critical alert ${event.alertId}`,
			},
		});

		// Get incident with service for trigger decision
		const incidentWithService = await this.prisma.incident.findUnique({
			where: { id: event.incidentId },
			include: { service: true },
		});

		if (!incidentWithService) {
			this.logger.error(`Incident ${event.incidentId} not found`);
			return;
		}

		// Trigger new investigation
		await this.triggerService.triggerInvestigation(incidentWithService, {
			shouldTrigger: true,
			triggerType: "re_trigger",
			reason: `Restarted due to critical alert: ${event.alert.title}`,
		});
	}

	/**
	 * Handle investigation completed - check for pending re-investigation
	 */
	@OnEvent("investigation.completed")
	async handleInvestigationCompleted(
		investigation: Investigation,
	): Promise<void> {
		this.logger.debug(`Investigation ${investigation.id} completed`);

		// Get incident with service
		const incident = await this.prisma.incident.findUnique({
			where: { id: investigation.incidentId },
			include: { service: true },
		});

		if (!incident) {
			return;
		}

		// Check if re-investigation needed
		const decision = await this.triggerService.shouldReInvestigate(incident, 0);

		if (decision.shouldTrigger) {
			this.logger.log(
				`Re-triggering investigation for incident ${incident.number}: ${decision.reason}`,
			);
			await this.triggerService.triggerInvestigation(incident, decision);
		}
	}
}
