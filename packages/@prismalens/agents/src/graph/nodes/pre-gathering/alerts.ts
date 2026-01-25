/**
 * Alert fetching for pre-gathering phase
 */

import { Logger } from "@prismalens/logger";
import type {
	AlertContext,
	AlertTimelineEvent,
	GatheredAlertsContext,
} from "../../../types/state.js";
import type { GatheringContext, GatherResult } from "./types.js";

const logger = new Logger({ context: "PreGather:Alerts" });

/**
 * Fetch full alert details and organize them for analysis
 */
export async function fetchFullAlerts(
	ctx: GatheringContext,
): Promise<GatherResult<GatheredAlertsContext>> {
	const startTime = Date.now();

	try {
		const { state } = ctx;
		const alerts = state.alerts;

		if (alerts.length === 0) {
			logger.debug("No alerts to process");
			return {
				success: true,
				data: {
					full: [],
					primary: null,
					timeline: [],
					groupedByService: {},
				},
				durationMs: Date.now() - startTime,
			};
		}

		// Build timeline from alerts
		const timeline: AlertTimelineEvent[] = alerts
			.filter((a) => a.triggeredAt)
			.map((alert) => ({
				alertId: alert.alertId,
				event: `Alert triggered: ${alert.title}`,
				timestamp: alert.triggeredAt!,
			}))
			.sort(
				(a, b) =>
					new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
			);

		// Group alerts by service
		const groupedByService: Record<string, AlertContext[]> = {};
		for (const alert of alerts) {
			const serviceKey = alert.serviceName || alert.serviceId || "unknown";
			if (!groupedByService[serviceKey]) {
				groupedByService[serviceKey] = [];
			}
			groupedByService[serviceKey].push(alert);
		}

		// Primary alert is the first one or the most severe
		const severityOrder = ["critical", "high", "medium", "low", "info"];
		const sortedAlerts = [...alerts].sort((a, b) => {
			const aIndex = severityOrder.indexOf(a.severity);
			const bIndex = severityOrder.indexOf(b.severity);
			return aIndex - bIndex;
		});
		const primary = sortedAlerts[0] || state.primaryAlert || null;

		logger.debug(`Processed ${alerts.length} alerts`, {
			servicesCount: Object.keys(groupedByService).length,
			timelineEvents: timeline.length,
		});

		return {
			success: true,
			data: {
				full: alerts,
				primary,
				timeline,
				groupedByService,
			},
			durationMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error("Failed to fetch alerts", { error: errorMessage });
		return {
			success: false,
			data: null,
			error: errorMessage,
			durationMs: Date.now() - startTime,
		};
	}
}

/**
 * Calculate alert velocity (alerts per minute)
 */
export function calculateAlertVelocity(alerts: AlertContext[]): number {
	if (alerts.length < 2) {
		return 0;
	}

	const timestamps = alerts
		.filter((a) => a.triggeredAt)
		.map((a) => new Date(a.triggeredAt!).getTime())
		.sort((a, b) => a - b);

	if (timestamps.length < 2) {
		return 0;
	}

	const firstAlert = timestamps[0];
	const lastAlert = timestamps[timestamps.length - 1];
	const durationMinutes = (lastAlert - firstAlert) / (1000 * 60);

	if (durationMinutes <= 0) {
		return alerts.length; // All at once
	}

	return alerts.length / durationMinutes;
}
