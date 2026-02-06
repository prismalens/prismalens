/**
 * Pre-Gathering Node for Investigation Graph
 *
 * Fetches context before Commander starts using parallel data fetching.
 * Based on BigPanda enrichment pattern: 60-90% of incidents are change-related.
 *
 * Graph Flow:
 * START → validateIncident → preGather → commander → writeToApi → END
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import { Logger } from "@prismalens/logger";
import type { DataProvider } from "../../../types/data-provider.js";
import type {
	GatheredAlertsContext,
	GatheredMetrics,
	GatheringMeta,
	InvestigationState,
	LogPreviewContext,
	PreGatheredContext,
	RecentChangesContext,
	ServiceContext,
	SimilarIncidentsContext,
} from "../../../types/index.js";
import { organizeAndEnrichAlerts } from "./alerts.js";
import { fetchRecentChanges, getTopRiskyDeployments } from "./changes.js";
import { hasLoggingIntegration, previewLogs } from "./logs.js";
import { calculateMetrics } from "./metrics.js";
import { fetchServiceContext } from "./service-context.js";
import {
	fetchSimilarIncidents,
	getTopSimilarIncidents,
} from "./similar-incidents.js";
import { PRE_GATHER_TIMEOUTS, type GatheringContext } from "./types.js";

const logger = new Logger({ context: "PreGather" });

// Re-export types and utilities
export * from "./types.js";
export { calculateDeploymentRiskScore, getTopRiskyDeployments } from "./changes.js";
export {
	calculateIncidentSimilarity,
	getTopSimilarIncidents,
	guessRootCauseCategory,
} from "./similar-incidents.js";
export { calculateAlertVelocity } from "./alerts.js";

/**
 * Wrap a promise with a timeout
 */
async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	name: string,
): Promise<{ result: T | null; timedOut: boolean }> {
	let timeoutId: NodeJS.Timeout;

	const timeoutPromise = new Promise<{ result: null; timedOut: true }>(
		(resolve) => {
			timeoutId = setTimeout(() => {
				logger.warn(`${name} timed out after ${timeoutMs}ms`);
				resolve({ result: null, timedOut: true });
			}, timeoutMs);
		},
	);

	const resultPromise = promise.then((result) => {
		clearTimeout(timeoutId);
		return { result, timedOut: false };
	});

	return Promise.race([resultPromise, timeoutPromise]);
}

/**
 * Quality score dimension definition.
 * Each dimension contributes a weighted score based on data presence and richness.
 */
interface QualityDimension {
	/** Weight of this dimension (summed to calculate maxScore) */
	weight: number;
	/** Whether this dimension is included (e.g., logs only if integration exists) */
	enabled: boolean;
	/** Score for having the data structure present (partial credit) */
	presentScore: number;
	/** Additional score for having rich/populated data */
	richScore: number;
	/** Check if data structure is present */
	isPresent: boolean;
	/** Check if data is rich (has meaningful content) */
	isRich: boolean;
}

/**
 * Calculate overall quality score based on data completeness.
 * Uses a data-driven approach: each source has a weight, a "present" score, and a "rich" score.
 */
function calculateQualityScore(
	alerts: GatheredAlertsContext | null,
	changes: RecentChangesContext | null,
	similar: SimilarIncidentsContext | null,
	service: ServiceContext | null,
	metrics: GatheredMetrics | null,
	logs: LogPreviewContext | null,
	hasLogging: boolean,
): number {
	const dimensions: QualityDimension[] = [
		{
			weight: 30,
			enabled: true,
			presentScore: 15,
			richScore: 15,
			isPresent: alerts != null,
			isRich: alerts != null && alerts.full.length > 0,
		},
		{
			weight: 20,
			enabled: true,
			presentScore: 10,
			richScore: 10,
			isPresent: changes != null,
			isRich: changes != null && (
				changes.deployments.length > 0 ||
				changes.commits.length > 0 ||
				changes.configChanges.length > 0
			),
		},
		{
			weight: 15,
			enabled: true,
			presentScore: 7.5,
			richScore: 7.5,
			isPresent: similar != null,
			isRich: similar != null && (similar.incidents.length > 0 || similar.patterns.length > 0),
		},
		{
			weight: 15,
			enabled: true,
			presentScore: 7.5,
			richScore: 7.5,
			isPresent: service != null,
			isRich: service != null && service.service != null,
		},
		{
			weight: 10,
			enabled: true,
			presentScore: 10,
			richScore: 0,
			isPresent: metrics != null,
			isRich: false,
		},
		{
			weight: 10,
			enabled: hasLogging,
			presentScore: 5,
			richScore: 5,
			isPresent: logs != null,
			isRich: logs != null && logs.errorLogs.length > 0,
		},
	];

	let score = 0;
	let maxScore = 0;

	for (const dim of dimensions) {
		if (!dim.enabled) continue;
		maxScore += dim.weight;
		if (dim.isRich) {
			score += dim.presentScore + dim.richScore;
		} else if (dim.isPresent) {
			score += dim.presentScore;
		}
	}

	return Math.round((score / maxScore) * 100) / 100;
}

/**
 * Build default empty gathered context for graceful degradation
 */
function buildEmptyGatheredContext(
	startTime: number,
	errors: { source: string; error: string }[],
): PreGatheredContext {
	return {
		alerts: {
			full: [],
			primary: null,
			timeline: [],
			groupedByService: {},
		},
		recentChanges: {
			deployments: [],
			commits: [],
			configChanges: [],
		},
		similarIncidents: {
			incidents: [],
			patterns: [],
			resolutions: [],
		},
		serviceContext: {
			service: null,
			dependencies: [],
			dependents: [],
			healthStatus: [],
		},
		metrics: {
			mtta: null,
			mttr: null,
			timeSinceFirstAlert: 0,
			alertVelocity: 0,
			affectedServices: [],
			similarIncidentCount: 0,
		},
		logPreview: null,
		gatheringMeta: {
			durationMs: Date.now() - startTime,
			sourcesQueried: [],
			errors,
			qualityScore: 0,
		},
	};
}

/**
 * Pre-Gather node - fetches context before Commander starts
 *
 * Runs parallel data fetching with individual timeouts and graceful degradation.
 * Each fetch can fail independently - Commander proceeds with whatever was gathered.
 *
 * @param state - Current investigation state
 * @param config - LangGraph runnable config containing dataProvider
 */
export async function preGather(
	state: InvestigationState,
	config: RunnableConfig,
): Promise<Partial<InvestigationState>> {
	const startTime = Date.now();
	const errors: { source: string; error: string }[] = [];
	const sourcesQueried: string[] = [];

	logger.info(`Starting pre-gathering for investigation ${state.investigationId}`);

	// Extract dataProvider from config
	const dataProvider = config.configurable?.dataProvider as DataProvider | undefined;
	if (!dataProvider) {
		throw new Error(
			"DataProvider not found in config.configurable. " +
			"Ensure the executor passes dataProvider when invoking the graph."
		);
	}

	// Build gathering context
	const incidentTime = state.incident?.triggeredAt
		? new Date(state.incident.triggeredAt)
		: new Date();

	const ctx: GatheringContext = {
		state,
		incidentTime,
		serviceId: state.incident?.serviceId,
		repository: state.primaryAlert?.repository,
		dataProvider,
		// Integrations resolved on-demand - credentials never pass through LangGraph
		integrations: [],
	};

	// Check for logging integration early
	const hasLogging = hasLoggingIntegration(ctx);

	// Run all fetches in parallel with individual timeouts
	const [
		alertsResult,
		changesResult,
		similarResult,
		serviceResult,
		metricsResult,
		logsResult,
	] = await Promise.all([
		withTimeout(
			organizeAndEnrichAlerts(ctx),
			PRE_GATHER_TIMEOUTS.ALERTS,
			"organizeAndEnrichAlerts",
		).then((r) => {
			sourcesQueried.push("alerts");
			return r;
		}),
		withTimeout(
			fetchRecentChanges(ctx),
			PRE_GATHER_TIMEOUTS.CHANGES,
			"fetchRecentChanges",
		).then((r) => {
			sourcesQueried.push("changes");
			return r;
		}),
		withTimeout(
			fetchSimilarIncidents(ctx),
			PRE_GATHER_TIMEOUTS.SIMILAR_INCIDENTS,
			"fetchSimilarIncidents",
		).then((r) => {
			sourcesQueried.push("similar_incidents");
			return r;
		}),
		withTimeout(
			fetchServiceContext(ctx),
			PRE_GATHER_TIMEOUTS.SERVICE_CONTEXT,
			"fetchServiceContext",
		).then((r) => {
			sourcesQueried.push("service_context");
			return r;
		}),
		withTimeout(
			calculateMetrics(ctx),
			PRE_GATHER_TIMEOUTS.METRICS,
			"calculateMetrics",
		).then((r) => {
			sourcesQueried.push("metrics");
			return r;
		}),
		hasLogging
			? withTimeout(previewLogs(ctx), PRE_GATHER_TIMEOUTS.LOGS, "previewLogs").then(
					(r) => {
						sourcesQueried.push("logs");
						return r;
					},
				)
			: Promise.resolve({ result: { success: true, data: null, error: undefined, durationMs: 0 }, timedOut: false }),
	]);

	// Process results with graceful degradation
	let alerts: GatheredAlertsContext | null = null;
	if (alertsResult.timedOut) {
		errors.push({ source: "alerts", error: "Timed out" });
	} else if (alertsResult.result && !alertsResult.result.success) {
		errors.push({ source: "alerts", error: alertsResult.result.error || "Unknown error" });
	} else if (alertsResult.result?.data) {
		alerts = alertsResult.result.data;
	}

	let changes: RecentChangesContext | null = null;
	if (changesResult.timedOut) {
		errors.push({ source: "changes", error: "Timed out" });
	} else if (changesResult.result && !changesResult.result.success) {
		errors.push({ source: "changes", error: changesResult.result.error || "Unknown error" });
	} else if (changesResult.result?.data) {
		changes = changesResult.result.data;
	}

	let similar: SimilarIncidentsContext | null = null;
	if (similarResult.timedOut) {
		errors.push({ source: "similar_incidents", error: "Timed out" });
	} else if (similarResult.result && !similarResult.result.success) {
		errors.push({ source: "similar_incidents", error: similarResult.result.error || "Unknown error" });
	} else if (similarResult.result?.data) {
		similar = similarResult.result.data;
	}

	let service: ServiceContext | null = null;
	if (serviceResult.timedOut) {
		errors.push({ source: "service_context", error: "Timed out" });
	} else if (serviceResult.result && !serviceResult.result.success) {
		errors.push({ source: "service_context", error: serviceResult.result.error || "Unknown error" });
	} else if (serviceResult.result?.data) {
		service = serviceResult.result.data;
	}

	let metrics: GatheredMetrics | null = null;
	if (metricsResult.timedOut) {
		errors.push({ source: "metrics", error: "Timed out" });
	} else if (metricsResult.result && !metricsResult.result.success) {
		errors.push({ source: "metrics", error: metricsResult.result.error || "Unknown error" });
	} else if (metricsResult.result?.data) {
		metrics = metricsResult.result.data;
	}

	let logs: LogPreviewContext | null = null;
	if (logsResult.timedOut) {
		errors.push({ source: "logs", error: "Timed out" });
	} else if (logsResult.result && !logsResult.result.success) {
		errors.push({ source: "logs", error: logsResult.result.error || "Unknown error" });
	} else if (logsResult.result?.data) {
		logs = logsResult.result.data;
	}

	// Calculate quality score
	const qualityScore = calculateQualityScore(
		alerts,
		changes,
		similar,
		service,
		metrics,
		logs,
		hasLogging,
	);

	// Build gathering metadata
	const gatheringMeta: GatheringMeta = {
		durationMs: Date.now() - startTime,
		sourcesQueried,
		errors,
		qualityScore,
	};

	// Build pre-gathered context
	const preGatheredContext: PreGatheredContext = {
		alerts: alerts || {
			full: state.alerts,
			primary: state.primaryAlert,
			timeline: [],
			groupedByService: {},
		},
		recentChanges: changes || {
			deployments: [],
			commits: [],
			configChanges: [],
		},
		similarIncidents: similar || {
			incidents: [],
			patterns: [],
			resolutions: [],
		},
		serviceContext: service || {
			service: null,
			dependencies: [],
			dependents: [],
			healthStatus: [],
		},
		metrics: metrics || {
			mtta: null,
			mttr: null,
			timeSinceFirstAlert: 0,
			alertVelocity: 0,
			affectedServices: [],
			similarIncidentCount: 0,
		},
		logPreview: logs,
		gatheringMeta,
	};

	logger.info(`Pre-gathering complete`, {
		durationMs: gatheringMeta.durationMs,
		qualityScore: (qualityScore * 100).toFixed(1) + "%",
		errors: errors.length,
		sourcesQueried: sourcesQueried.length,
	});

	// Log any high-risk changes or similar incidents found
	if (changes) {
		const topRisky = getTopRiskyDeployments(changes.deployments, 1);
		if (topRisky.length > 0) {
			logger.info(`High-risk deployment detected`, {
				riskScore: topRisky[0].riskScore,
				factors: topRisky[0].riskFactors,
			});
		}
	}

	if (similar) {
		const topSimilar = getTopSimilarIncidents(similar.incidents, 1);
		if (topSimilar.length > 0) {
			logger.info(`Similar incident found`, {
				similarity: topSimilar[0].similarity,
				incidentId: topSimilar[0].incidentId,
			});
		}
	}

	return {
		preGatheredContext,
		// Also update alerts from pre-gathered context if we got better data
		alerts: alerts?.full || state.alerts,
		dataQuality: {
			preGathering: qualityScore,
		},
		dataSourcesUsed: sourcesQueried,
	};
}
