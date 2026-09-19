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
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { TimelineService } from "../timeline/timeline.service.js";
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
		private readonly timeline: TimelineService,
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

		// Whether a run starts was decided once, on the alert that opened the
		// incident (InvestigationTriggerService on alert.correlated). A later
		// alert only feeds a run that is already active.
		if (!activeInvestigation) return;

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
		await this.recordArrival(
			investigation,
			event,
			"The running investigation does not read it: its report covers the alerts it started with. Re-run the investigation to include this one.",
		);
	}

	/**
	 * Queue a partial update job after investigation completes
	 */
	async queuePartialUpdate(
		investigation: Investigation,
		event: AlertAddedEvent,
	): Promise<void> {
		await this.recordArrival(
			investigation,
			event,
			"Partial re-analysis is not built, so nothing is queued. Re-run the investigation to include this alert.",
		);
	}

	/**
	 * Say on the incident's own timeline that an alert arrived mid-run and what
	 * happened to it. Both strategies above used to log server-side and return,
	 * so an alert that arrived during a run vanished from the operator's view
	 * (#564: an unfinished feature that ships broken). Honest and visible beats
	 * a silent drop; neither strategy pretends to fold the alert into the report.
	 */
	private async recordArrival(
		investigation: Investigation,
		event: AlertAddedEvent,
		consequence: string,
	): Promise<void> {
		this.logger.warn(
			`Alert ${event.alertId} arrived during investigation ${investigation.id}: ${consequence}`,
		);
		try {
			await this.timeline.create({
				incidentId: event.incidentId,
				type: TimelineEntryType.alert_added,
				title: "Alert arrived during the investigation",
				description: `${event.alert.title} (${event.alert.severity}). ${consequence}`,
				source: TimelineSource.system,
				metadata: {
					investigationId: investigation.id,
					alertId: event.alertId,
				},
			});
		} catch (e) {
			this.logger.error(
				"Failed to record the alert arrival on the timeline",
				e,
			);
		}
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
}
