/**
 * PreGatheredContext Factory
 *
 * Creates complete PreGatheredContext objects for evaluation scenarios.
 * Combines all the individual mock factories into a coherent context.
 */

import { faker } from "@faker-js/faker";
import type {
	AlertContext,
	GatheredAlertsContext,
	GatheredMetrics,
	GatheringMeta,
	LogEntry,
	LogPreviewContext,
	PreGatheredContext,
	RecentChangesContext,
	ServiceContext,
	ServiceInfo,
	SimilarIncidentMatch,
	SimilarIncidentsContext,
} from "../../src/types/state.js";
import {
	createMockConfigChanges,
	createMockDeployments,
	createMockCommits,
	type CreateRecentChangesOptions,
	createMockRecentChanges,
} from "./pre-gathered.js";

// =============================================================================
// ALERTS CONTEXT FACTORY
// =============================================================================

export interface CreateAlertsContextOptions {
	/** Full alert details */
	alerts?: AlertContext[];
	/** Primary alert (defaults to first alert) */
	primaryAlert?: AlertContext | null;
	/** Service name for grouping */
	serviceName?: string;
}

/**
 * Create mock GatheredAlertsContext.
 */
export function createMockAlertsContext(options: CreateAlertsContextOptions = {}): GatheredAlertsContext {
	const alerts = options.alerts || [];
	const primaryAlert = options.primaryAlert ?? alerts[0] ?? null;
	const serviceName = options.serviceName || "api-server";

	// Group alerts by service
	const groupedByService: Record<string, AlertContext[]> = {};
	for (const alert of alerts) {
		const svc = alert.serviceName || serviceName;
		if (!groupedByService[svc]) {
			groupedByService[svc] = [];
		}
		groupedByService[svc].push(alert);
	}

	// Create timeline from alerts
	const timeline = alerts.map((alert) => ({
		alertId: alert.alertId,
		event: `Alert ${alert.title} triggered`,
		timestamp: alert.triggeredAt || new Date().toISOString(),
	}));

	return {
		full: alerts,
		primary: primaryAlert,
		timeline,
		groupedByService,
	};
}

// =============================================================================
// SERVICE CONTEXT FACTORY
// =============================================================================

export interface CreateServiceContextOptions {
	serviceName?: string;
	serviceId?: string;
	serviceType?: string;
	tier?: string;
	team?: string;
	repository?: string;
	dependencies?: string[];
	dependents?: string[];
}

/**
 * Create mock ServiceContext.
 */
export function createMockServiceContext(options: CreateServiceContextOptions = {}): ServiceContext {
	const serviceName = options.serviceName || "api-server";
	const serviceId = options.serviceId || `svc-${faker.string.alphanumeric(8)}`;

	const service: ServiceInfo = {
		id: serviceId,
		name: serviceName,
		displayName: options.serviceName || faker.helpers.arrayElement([
			"API Server",
			"Web Frontend",
			"Auth Service",
			"Payment Service",
		]),
		type: options.serviceType || faker.helpers.arrayElement(["web", "worker", "api", "cron"]),
		tier: options.tier || faker.helpers.arrayElement(["critical", "high", "medium", "low"]),
		team: options.team || faker.helpers.arrayElement(["platform", "backend", "frontend", "infra"]),
		repository: options.repository || `org/${serviceName}`,
	};

	return {
		service,
		dependencies: options.dependencies || ["database", "redis", "auth-service"],
		dependents: options.dependents || ["web-frontend", "mobile-api"],
		healthStatus: [
			{
				status: "healthy",
				lastCheck: new Date().toISOString(),
				message: "All health checks passing",
			},
		],
	};
}

// =============================================================================
// SIMILAR INCIDENTS FACTORY
// =============================================================================

export interface CreateSimilarIncidentsOptions {
	/** Number of similar incidents to generate */
	count?: number;
	/** Similarity threshold (default 30%) */
	minSimilarity?: number;
}

/**
 * Create mock SimilarIncidentsContext.
 */
export function createMockSimilarIncidents(options: CreateSimilarIncidentsOptions = {}): SimilarIncidentsContext {
	const count = options.count ?? 2;
	const minSimilarity = options.minSimilarity ?? 30;

	const incidents: SimilarIncidentMatch[] = Array.from({ length: count }, (_, i) => ({
		incidentId: `inc-similar-${faker.string.alphanumeric(6)}`,
		number: faker.number.int({ min: 1000, max: 9999 }),
		title: faker.helpers.arrayElement([
			"High error rate in api-server",
			"Database connection pool exhausted",
			"Memory spike causing OOM kills",
			"Latency increase in auth-service",
		]),
		similarity: minSimilarity + faker.number.int({ min: 0, max: 70 - i * 10 }),
		resolution: faker.helpers.arrayElement([
			"Rolled back deployment",
			"Increased connection pool size",
			"Fixed null pointer in UserService",
			"Scaled up worker pods",
		]),
		rootCause: faker.helpers.arrayElement([
			"Code regression in recent deployment",
			"Configuration change caused resource exhaustion",
			"Memory leak in worker process",
		]),
		timeToResolve: faker.number.int({ min: 300, max: 7200 }), // 5 min to 2 hours
		resolvedAt: new Date(Date.now() - faker.number.int({ min: 1, max: 30 }) * 24 * 60 * 60 * 1000).toISOString(),
	}));

	return {
		incidents,
		patterns: [
			{
				pattern: "High error rate after deployment",
				count: faker.number.int({ min: 3, max: 10 }),
				lastOccurrence: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
				serviceName: "api-server",
			},
		],
		resolutions: incidents
			.filter((i) => i.resolution)
			.map((i) => ({
				incidentId: i.incidentId,
				summary: i.resolution!,
				timeToResolve: i.timeToResolve!,
				rootCauseCategory: faker.helpers.arrayElement(["code", "config", "infrastructure"]),
			})),
	};
}

// =============================================================================
// METRICS FACTORY
// =============================================================================

export interface CreateMetricsOptions {
	alertCount?: number;
	serviceName?: string;
	mtta?: number;
	mttr?: number;
}

/**
 * Create mock GatheredMetrics.
 */
export function createMockMetrics(options: CreateMetricsOptions = {}): GatheredMetrics {
	return {
		mtta: options.mtta ?? faker.number.int({ min: 60, max: 600 }), // 1-10 minutes
		mttr: options.mttr ?? faker.number.int({ min: 300, max: 3600 }), // 5-60 minutes
		timeSinceFirstAlert: faker.number.int({ min: 60, max: 1800 }), // 1-30 minutes
		alertVelocity: faker.number.float({ min: 0.1, max: 5, fractionDigits: 2 }), // alerts per minute
		affectedServices: [options.serviceName || "api-server"],
		similarIncidentCount: faker.number.int({ min: 0, max: 5 }),
	};
}

// =============================================================================
// LOG PREVIEW FACTORY
// =============================================================================

export interface CreateLogPreviewOptions {
	/** Number of error logs to include */
	errorCount?: number;
	/** Service name */
	serviceName?: string;
	/** Include stack traces */
	includeStackTraces?: boolean;
}

/**
 * Create mock LogPreviewContext.
 */
export function createMockLogPreview(options: CreateLogPreviewOptions = {}): LogPreviewContext {
	const errorCount = options.errorCount ?? 5;
	const serviceName = options.serviceName || "api-server";
	const includeStackTraces = options.includeStackTraces ?? true;

	const errorMessages = [
		"NullPointerException in UserService.getUser()",
		"Connection refused: max_connections exceeded",
		"Timeout waiting for response from database",
		"Failed to authenticate user: invalid token",
		"OutOfMemoryError: Java heap space",
		"Redis connection pool exhausted",
	];

	const stackTrace = includeStackTraces
		? "\n  at com.example.UserService.getUser(UserService.java:42)\n  at com.example.ApiController.handleRequest(ApiController.java:128)"
		: "";

	const now = Date.now();
	const errorLogs: LogEntry[] = Array.from({ length: errorCount }, (_, i) => ({
		message: faker.helpers.arrayElement(errorMessages) + stackTrace,
		timestamp: new Date(now - i * 1000).toISOString(), // 1 second apart
		level: faker.helpers.arrayElement(["error", "warn"]) as "error" | "warn",
		service: serviceName,
		traceId: faker.string.alphanumeric(16),
	}));

	return {
		errorLogs,
		timeRange: {
			start: new Date(now - 30 * 60 * 1000).toISOString(), // 30 min ago
			end: new Date(now).toISOString(),
		},
		source: "render",
	};
}

// =============================================================================
// GATHERING META FACTORY
// =============================================================================

export interface CreateGatheringMetaOptions {
	durationMs?: number;
	sourcesQueried?: string[];
	errors?: Array<{ source: string; error: string }>;
	qualityScore?: number;
}

/**
 * Create mock GatheringMeta.
 */
export function createMockGatheringMeta(options: CreateGatheringMetaOptions = {}): GatheringMeta {
	return {
		durationMs: options.durationMs ?? faker.number.int({ min: 500, max: 5000 }),
		sourcesQueried: options.sourcesQueried || ["database", "render", "github"],
		errors: options.errors || [],
		qualityScore: options.qualityScore ?? faker.number.float({ min: 0.7, max: 1.0, fractionDigits: 2 }),
	};
}

// =============================================================================
// COMPLETE PREGATHERED CONTEXT FACTORY
// =============================================================================

export interface CreatePreGatheredContextOptions {
	// Alert/incident context
	alerts?: AlertContext[];
	serviceName?: string;

	// Change data (can use shortcuts or full objects)
	recentChanges?: RecentChangesContext;
	deploymentCount?: number;
	commitCount?: number;
	configChangeCount?: number;

	// Similar incidents
	similarIncidentCount?: number;

	// Log preview
	includeLogPreview?: boolean;
	errorLogCount?: number;
	includeStackTraces?: boolean;

	// Quality
	qualityScore?: number;
}

/**
 * Create a complete PreGatheredContext for evaluations.
 *
 * @example
 * ```typescript
 * // Simple usage with auto-generated data
 * const context = createMockPreGatheredContext({
 *   serviceName: "api-server",
 *   deploymentCount: 2,
 *   commitCount: 5,
 * });
 *
 * // With custom change data
 * const context = createMockPreGatheredContext({
 *   recentChanges: {
 *     deployments: [createMockDeployment({ status: "failed", riskScore: 90 })],
 *     commits: [],
 *     configChanges: [],
 *   },
 * });
 * ```
 */
export function createMockPreGatheredContext(options: CreatePreGatheredContextOptions = {}): PreGatheredContext {
	const serviceName = options.serviceName || "api-server";

	// Build recent changes
	const recentChanges: RecentChangesContext = options.recentChanges || createMockRecentChanges({
		deploymentCount: options.deploymentCount,
		commitCount: options.commitCount,
		configChangeCount: options.configChangeCount,
	});

	return {
		alerts: createMockAlertsContext({
			alerts: options.alerts,
			serviceName,
		}),
		recentChanges,
		similarIncidents: createMockSimilarIncidents({
			count: options.similarIncidentCount ?? 2,
		}),
		serviceContext: createMockServiceContext({
			serviceName,
		}),
		metrics: createMockMetrics({
			serviceName,
			alertCount: options.alerts?.length ?? 1,
		}),
		logPreview: options.includeLogPreview !== false
			? createMockLogPreview({
				serviceName,
				errorCount: options.errorLogCount ?? 5,
				includeStackTraces: options.includeStackTraces ?? true,
			})
			: null,
		gatheringMeta: createMockGatheringMeta({
			qualityScore: options.qualityScore,
		}),
	};
}

// =============================================================================
// SCENARIO-SPECIFIC FACTORIES
// =============================================================================

/**
 * Create PreGatheredContext for a failed deployment scenario.
 */
export function createFailedDeploymentContext(serviceName = "api-server"): PreGatheredContext {
	return createMockPreGatheredContext({
		serviceName,
		recentChanges: {
			deployments: createMockDeployments(1, {
				service: serviceName,
				status: "failed",
				riskScore: 90,
				riskFactors: ["deployment failed", "deployed 15 min before incident"],
			}),
			commits: createMockCommits(2),
			configChanges: [],
		},
		includeLogPreview: true,
		includeStackTraces: true,
	});
}

/**
 * Create PreGatheredContext for a config change scenario.
 */
export function createConfigChangeContext(serviceName = "api-server"): PreGatheredContext {
	return createMockPreGatheredContext({
		serviceName,
		recentChanges: {
			deployments: [],
			commits: [],
			configChanges: createMockConfigChanges(2, {
				key: "DATABASE_POOL_SIZE",
			}),
		},
		includeLogPreview: true,
	});
}

/**
 * Create PreGatheredContext for a code bug scenario.
 */
export function createCodeBugContext(serviceName = "api-server"): PreGatheredContext {
	return createMockPreGatheredContext({
		serviceName,
		recentChanges: {
			deployments: createMockDeployments(1, { service: serviceName, status: "success" }),
			commits: createMockCommits(3),
			configChanges: [],
		},
		includeLogPreview: true,
		includeStackTraces: true,
	});
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
	// Main factory
	createMockPreGatheredContext,

	// Component factories
	createMockAlertsContext,
	createMockServiceContext,
	createMockSimilarIncidents,
	createMockMetrics,
	createMockLogPreview,
	createMockGatheringMeta,

	// Scenario-specific factories
	createFailedDeploymentContext,
	createConfigChangeContext,
	createCodeBugContext,
};
