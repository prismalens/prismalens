/**
 * Alert organization and enrichment for pre-gathering phase
 *
 * Note: This function was previously named "fetchFullAlerts" which was misleading
 * since it didn't fetch anything. It now properly fetches additional alerts via
 * DataProvider when needed, and organizes them for analysis.
 */

import { Logger } from "@prismalens/logger";
import type {
	AlertContext,
	AlertTimelineEvent,
	GatheredAlertsContext,
} from "../../../types/index.js";
import type { GatheringContext, GatherResult } from "./types.js";

const logger = new Logger({ context: "PreGather:Alerts" });

/**
 * Minimum number of alerts before we try to fetch more.
 * If we have fewer than this, we'll use dataProvider to get additional alerts.
 */
const MIN_ALERTS_THRESHOLD = 3;

/**
 * Maximum number of alerts to fetch via dataProvider
 */
const MAX_ALERTS_TO_FETCH = 10;

/**
 * Organize and enrich alerts for analysis.
 *
 * This function:
 * 1. Fetches additional alerts via DataProvider if we have few alerts
 * 2. Organizes alerts into a timeline
 * 3. Groups alerts by service
 * 4. Identifies the primary (most severe) alert
 *
 * @param ctx - Gathering context with state and dataProvider
 * @returns Organized alert context for investigation
 */
export async function organizeAndEnrichAlerts(
	ctx: GatheringContext,
): Promise<GatherResult<GatheredAlertsContext>> {
	const startTime = Date.now();

	try {
		const { state, dataProvider } = ctx;
		let alerts = [...state.alerts];

		// If we have few alerts, try to fetch more from the incident
		if (alerts.length < MIN_ALERTS_THRESHOLD && state.incidentId) {
			logger.debug(
				`Only ${alerts.length} alerts in state, fetching more via dataProvider`,
			);

			try {
				const { alerts: additionalAlerts } = await dataProvider.fetchAlerts({
					incidentId: state.incidentId,
					limit: MAX_ALERTS_TO_FETCH,
				});

				// Merge without duplicates
				const existingIds = new Set(alerts.map((a) => a.alertId));
				let addedCount = 0;
				for (const alert of additionalAlerts) {
					if (!existingIds.has(alert.alertId)) {
						alerts.push(alert);
						addedCount++;
					}
				}

				if (addedCount > 0) {
					logger.debug(`Added ${addedCount} additional alerts via dataProvider`);
				}
			} catch (error) {
				// Log but don't fail - we can proceed with existing alerts
				logger.warn("Failed to fetch additional alerts via dataProvider", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

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

		// Primary alert is the most severe one
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
		logger.error("Failed to organize alerts", { error: errorMessage });
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
