/**
 * Metrics calculation for pre-gathering phase
 */

import { Logger } from "@prismalens/logger";
import type { AlertContext, GatheredMetrics } from "../../../types/index.js";
import { calculateAlertVelocity } from "./alerts.js";
import type { GatheringContext, GatherResult } from "./types.js";

const logger = new Logger({ context: "PreGather:Metrics" });

/**
 * Calculate investigation metrics from state and context
 */
export async function calculateMetrics(
	ctx: GatheringContext,
): Promise<GatherResult<GatheredMetrics>> {
	const startTime = Date.now();

	try {
		const { state, incidentTime } = ctx;
		const alerts = state.alerts;
		const incident = state.incident;

		logger.debug("Calculating metrics", {
			alertCount: alerts.length,
			hasIncident: !!incident,
		});

		// Calculate time since first alert
		let timeSinceFirstAlert = 0;
		const alertTimestamps = alerts
			.filter((a) => a.triggeredAt)
			.map((a) => new Date(a.triggeredAt!).getTime());

		if (alertTimestamps.length > 0) {
			const firstAlertTime = Math.min(...alertTimestamps);
			timeSinceFirstAlert = Math.floor((Date.now() - firstAlertTime) / 1000);
		}

		// Calculate alert velocity
		const alertVelocity = calculateAlertVelocity(alerts);

		// Collect affected services
		const affectedServicesSet = new Set<string>();
		for (const alert of alerts) {
			if (alert.serviceName) {
				affectedServicesSet.add(alert.serviceName);
			} else if (alert.serviceId) {
				affectedServicesSet.add(alert.serviceId);
			}
		}
		if (incident?.serviceName) {
			affectedServicesSet.add(incident.serviceName);
		}
		const affectedServices = Array.from(affectedServicesSet);

		// TODO: Calculate MTTA and MTTR from similar incidents when IncidentSimilarity is implemented
		const mtta: number | null = null;
		const mttr: number | null = null;

		// TODO: Get similar incident count from IncidentSimilarity table
		const similarIncidentCount = 0;

		logger.debug("Calculated metrics", {
			timeSinceFirstAlert,
			alertVelocity: alertVelocity.toFixed(2),
			affectedServices: affectedServices.length,
		});

		return {
			success: true,
			data: {
				mtta,
				mttr,
				timeSinceFirstAlert,
				alertVelocity,
				affectedServices,
				similarIncidentCount,
			},
			durationMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		logger.error("Failed to calculate metrics", { error: errorMessage });
		return {
			success: false,
			data: null,
			error: errorMessage,
			durationMs: Date.now() - startTime,
		};
	}
}
