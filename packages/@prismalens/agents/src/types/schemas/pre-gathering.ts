/**
 * Pre-Gathered Context Schemas
 *
 * Pre-commander data gathering schemas based on BigPanda enrichment patterns.
 * Key insight: 60-90% of incidents are change-related, so pre-gathering
 * change context dramatically improves investigation quality.
 */

import { z } from "zod";
import { AlertContextSchema } from "./core.js";

// =============================================================================
// ALERT TIMELINE
// =============================================================================

/**
 * Timeline event for alert activity
 */
export const AlertTimelineEventSchema = z.object({
	alertId: z.string(),
	event: z.string(),
	timestamp: z.string(),
});

export type AlertTimelineEvent = z.infer<typeof AlertTimelineEventSchema>;

// =============================================================================
// GATHERED ALERTS CONTEXT
// =============================================================================

/**
 * Gathered alerts context - full details, not just counts
 */
export const GatheredAlertsContextSchema = z.object({
	/** Full alert details for all correlated alerts */
	full: z.array(AlertContextSchema),
	/** Primary alert that triggered the investigation */
	primary: AlertContextSchema.nullable(),
	/** Timeline of alert events */
	timeline: z.array(AlertTimelineEventSchema),
	/** Alerts grouped by service for easier analysis */
	groupedByService: z.record(z.string(), z.array(AlertContextSchema)),
});

export type GatheredAlertsContext = z.infer<typeof GatheredAlertsContextSchema>;

// =============================================================================
// CHANGE SCHEMAS
// =============================================================================

/**
 * Deployment change with risk scoring (BigPanda pattern)
 */
export const DeploymentChangeSchema = z.object({
	id: z.string(),
	timestamp: z.string(),
	service: z.string().optional(),
	environment: z.string().optional(),
	version: z.string().optional(),
	status: z.enum(["success", "failed", "rolled_back", "in_progress"]).optional(),
	containsMigration: z.boolean().optional(),
	/** Risk score 0-100 based on time proximity and change characteristics */
	riskScore: z.number().min(0).max(100),
	/** Factors contributing to risk score */
	riskFactors: z.array(z.string()),
	/** Link to deployment details */
	url: z.string().optional(),
});

export type DeploymentChange = z.infer<typeof DeploymentChangeSchema>;

/**
 * Git commit change
 */
export const CommitChangeSchema = z.object({
	sha: z.string(),
	message: z.string(),
	author: z.string(),
	timestamp: z.string(),
	repository: z.string().optional(),
	url: z.string().optional(),
});

export type CommitChange = z.infer<typeof CommitChangeSchema>;

/**
 * Configuration change
 */
export const ConfigChangeSchema = z.object({
	key: z.string(),
	oldValue: z.string().optional(),
	newValue: z.string().optional(),
	timestamp: z.string(),
	source: z.string().optional(),
});

export type ConfigChange = z.infer<typeof ConfigChangeSchema>;

/**
 * Recent changes context - deployments, commits, config changes
 * BigPanda pattern: 60-90% of incidents are change-related
 */
export const RecentChangesContextSchema = z.object({
	/** Recent deployments with risk scores */
	deployments: z.array(DeploymentChangeSchema),
	/** Recent commits in relevant repositories */
	commits: z.array(CommitChangeSchema),
	/** Recent configuration changes */
	configChanges: z.array(ConfigChangeSchema),
});

export type RecentChangesContext = z.infer<typeof RecentChangesContextSchema>;

// =============================================================================
// SIMILAR INCIDENTS
// =============================================================================

/**
 * Similar incident match
 */
export const SimilarIncidentMatchSchema = z.object({
	incidentId: z.string(),
	number: z.number().optional(),
	title: z.string().optional(),
	/** Similarity score 0-100 (BigPanda uses 30% threshold) */
	similarity: z.number().min(0).max(100),
	/** How it was resolved (if resolved) */
	resolution: z.string().optional(),
	/** Root cause from that incident */
	rootCause: z.string().optional(),
	/** Time to resolve in seconds */
	timeToResolve: z.number().optional(),
	resolvedAt: z.string().optional(),
});

export type SimilarIncidentMatch = z.infer<typeof SimilarIncidentMatchSchema>;

/**
 * Recurring incident pattern
 */
export const IncidentPatternSchema = z.object({
	pattern: z.string(),
	count: z.number(),
	lastOccurrence: z.string(),
	serviceName: z.string().optional(),
});

export type IncidentPattern = z.infer<typeof IncidentPatternSchema>;

/**
 * Past resolution info
 */
export const PastResolutionSchema = z.object({
	incidentId: z.string(),
	summary: z.string(),
	timeToResolve: z.number(), // seconds
	rootCauseCategory: z.string().optional(),
});

export type PastResolution = z.infer<typeof PastResolutionSchema>;

/**
 * Similar incidents context (BigPanda 30% threshold pattern)
 */
export const SimilarIncidentsContextSchema = z.object({
	/** Similar past incidents with similarity scores */
	incidents: z.array(SimilarIncidentMatchSchema),
	/** Recurring patterns identified */
	patterns: z.array(IncidentPatternSchema),
	/** Past resolutions for learning */
	resolutions: z.array(PastResolutionSchema),
});

export type SimilarIncidentsContext = z.infer<
	typeof SimilarIncidentsContextSchema
>;

// =============================================================================
// SERVICE CONTEXT
// =============================================================================

/**
 * Service info for context
 */
export const ServiceInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	displayName: z.string().optional(),
	type: z.string().optional(),
	tier: z.string().optional(),
	team: z.string().optional(),
	repository: z.string().optional(),
});

export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

/**
 * Service health status
 */
export const ServiceHealthStatusSchema = z.object({
	status: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
	lastCheck: z.string().optional(),
	message: z.string().optional(),
});

export type ServiceHealthStatus = z.infer<typeof ServiceHealthStatusSchema>;

/**
 * Service context - service info and dependencies
 */
export const ServiceContextSchema = z.object({
	/** Primary service info */
	service: ServiceInfoSchema.nullable(),
	/** Services this service depends on */
	dependencies: z.array(z.string()),
	/** Services that depend on this service */
	dependents: z.array(z.string()),
	/** Health status of related services */
	healthStatus: z.array(ServiceHealthStatusSchema),
});

export type ServiceContext = z.infer<typeof ServiceContextSchema>;

// =============================================================================
// METRICS
// =============================================================================

/**
 * Pre-gathered metrics
 */
export const GatheredMetricsSchema = z.object({
	/** Mean time to acknowledge for similar incidents */
	mtta: z.number().nullable(),
	/** Mean time to resolve for similar incidents */
	mttr: z.number().nullable(),
	/** Time since first alert in seconds */
	timeSinceFirstAlert: z.number(),
	/** Rate of alerts per minute */
	alertVelocity: z.number(),
	/** List of affected service names */
	affectedServices: z.array(z.string()),
	/** Number of similar incidents in past 30 days */
	similarIncidentCount: z.number().optional(),
});

export type GatheredMetrics = z.infer<typeof GatheredMetricsSchema>;

// =============================================================================
// LOG PREVIEW
// =============================================================================

/**
 * Log entry for preview
 */
export const LogEntrySchema = z.object({
	message: z.string(),
	timestamp: z.string(),
	level: z.enum(["error", "warn", "info", "debug"]),
	service: z.string().optional(),
	traceId: z.string().optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * Pre-scanned log preview (if integration available)
 */
export const LogPreviewContextSchema = z.object({
	/** Sample of error/warning logs */
	errorLogs: z.array(LogEntrySchema),
	/** Time range of logs fetched */
	timeRange: z.object({
		start: z.string(),
		end: z.string(),
	}),
	/** Source of the logs */
	source: z.string().optional(),
});

export type LogPreviewContext = z.infer<typeof LogPreviewContextSchema>;

// =============================================================================
// GATHERING META
// =============================================================================

/**
 * Gathering metadata for observability
 */
export const GatheringMetaSchema = z.object({
	/** Total time spent gathering in milliseconds */
	durationMs: z.number(),
	/** Data sources that were queried */
	sourcesQueried: z.array(z.string()),
	/** Errors encountered during gathering (graceful degradation) */
	errors: z.array(
		z.object({
			source: z.string(),
			error: z.string(),
		}),
	),
	/** Overall quality score 0-1 based on completeness */
	qualityScore: z.number().min(0).max(1),
});

export type GatheringMeta = z.infer<typeof GatheringMetaSchema>;

// =============================================================================
// COMPLETE PRE-GATHERED CONTEXT
// =============================================================================

/**
 * Complete pre-gathered context structure
 * Gathered before Commander starts to provide rich initial context
 */
export const PreGatheredContextSchema = z.object({
	/** Alerts context with full details */
	alerts: GatheredAlertsContextSchema,
	/** Recent changes - deployments, commits, config (BigPanda pattern) */
	recentChanges: RecentChangesContextSchema,
	/** Similar past incidents for pattern matching */
	similarIncidents: SimilarIncidentsContextSchema,
	/** Service context - info and topology */
	serviceContext: ServiceContextSchema,
	/** Calculated metrics */
	metrics: GatheredMetricsSchema,
	/** Pre-scanned log preview (nullable if no logging integration) */
	logPreview: LogPreviewContextSchema.nullable(),
	/** Gathering metadata */
	gatheringMeta: GatheringMetaSchema,
});

export type PreGatheredContext = z.infer<typeof PreGatheredContextSchema>;

// =============================================================================
// PENDING ALERT
// =============================================================================

/**
 * Pending alert that arrived during an ongoing investigation
 */
export const PendingAlertSchema = z.object({
	alertId: z.string(),
	title: z.string(),
	severity: z.enum(["critical", "high", "medium", "low", "info"]),
	addedAt: z.string(),
});

export type PendingAlert = z.infer<typeof PendingAlertSchema>;
