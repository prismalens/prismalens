/**
 * Metrics calculation for pre-gathering phase
 */

import { Logger } from "@prismalens/logger";
import type {
	GatheredMetrics,
	SimilarIncidentsContext,
} from "../../../types/index.js";
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
		const { state } = ctx;
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

		// MTTA/MTTR will be enriched post-parallel via enrichMetricsWithSimilarIncidents
		const mtta: number | null = null;
		const mttr: number | null = null;
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

/**
 * Enrich metrics with MTTA/MTTR computed from similar incidents.
 * Called after both metrics and similar-incidents have resolved (post-parallel).
 */
export function enrichMetricsWithSimilarIncidents(
	metrics: GatheredMetrics,
	similarIncidents: SimilarIncidentsContext | null,
): GatheredMetrics {
	if (!similarIncidents || similarIncidents.incidents.length === 0) {
		return metrics;
	}

	// Compute average timeToResolve (MTTR) from similar incidents
	const resolvedIncidents = similarIncidents.incidents.filter(
		(i) => i.timeToResolve != null && i.timeToResolve > 0,
	);

	let mttr: number | null = null;
	if (resolvedIncidents.length > 0) {
		const totalResolveTime = resolvedIncidents.reduce(
			(sum, i) => sum + (i.timeToResolve ?? 0),
			0,
		);
		mttr = Math.round(totalResolveTime / resolvedIncidents.length);
	}

	// MTTA is not available from current schema (incidents don't store acknowledgedAt
	// in SimilarIncidentMatch), but we set it from metrics if available
	const mtta = metrics.mtta;

	return {
		...metrics,
		mtta,
		mttr,
		similarIncidentCount: similarIncidents.incidents.length,
	};
}
