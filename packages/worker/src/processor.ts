import {
	type InvestigationResult as AgentResult,
	type AlertContext,
	type AlertFetchRequest,
	type AlertFetchResponse,
	type DataProvider,
	type IncidentContext,
	type IntegrationWithCredentials,
	InvestigationExecutor,
	type InvestigationConfig,
	type InvestigationInput,
	type Recommendation,
	type SimilarIncidentMatch,
	type SimilarIncidentRequest,
	type SimilarIncidentResponse,
	mapSeverity,
	createCheckpointer,
	ExecutionTracker,
} from "@prismalens/agents";
import {
	buildCheckpointerUrl,
	getCheckpointerSchema,
	databaseSchema,
} from "@prismalens/config";
import { Logger, enrichContext } from "@prismalens/logger";
import { runWithWideEvent } from "@prismalens/logger/standalone";
import type { Job } from "bullmq";
import crypto from "node:crypto";
import { Redis } from "ioredis";
import { config as workerConfig, redisUrl } from "./config.js";
import { api } from "./orpc-client.js";
import type { InvestigationJobData, InvestigationResult } from "./types.js";

// =============================================================================
// INVESTIGATION JOB PROCESSOR
// =============================================================================
// Processes investigation jobs from the BullMQ queue.
// Uses the @prismalens/agents package for investigation execution.
// =============================================================================

// =============================================================================
// WORKER DATA PROVIDER
// =============================================================================
// DataProvider implementation for queue mode.
// Uses oRPC client to fetch data from the API.
// =============================================================================

/**
 * DataProvider implementation for worker (queue) mode.
 * Uses the oRPC client to fetch data from the API server.
 */
class WorkerDataProvider implements DataProvider {
	private logger = new Logger({ context: "WorkerDataProvider" });

	/**
	 * Fetch alerts via oRPC API
	 */
	async fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse> {
		try {
			const alerts = await api.alerts.list({
				incidentId: request.incidentId,
				serviceId: request.serviceId,
				limit: request.limit || 50,
			});

			// Filter by specific IDs if provided
			let filteredAlerts = alerts;
			const alertIds = (request as AlertFetchRequest & { alertIds?: string[] }).alertIds;
			if (alertIds && alertIds.length > 0) {
				const idSet = new Set(alertIds);
				filteredAlerts = alerts.filter((a: { id: string }) => idSet.has(a.id));
			}

			return {
				alerts: filteredAlerts.map((a: Record<string, unknown>) =>
					this.mapAlertToContext(a),
				),
				hasMore: alerts.length >= (request.limit || 50),
			};
		} catch (error) {
			this.logger.error("Failed to fetch alerts via API", { error });
			return { alerts: [], hasMore: false };
		}
	}

	/**
	 * Fetch a single incident via oRPC API
	 */
	async fetchIncident(incidentId: string): Promise<IncidentContext | null> {
		try {
			const incident = await api.incidents.get({ id: incidentId });
			return this.mapIncidentToContext(incident);
		} catch (error) {
			this.logger.warn(`Failed to fetch incident ${incidentId}`, { error });
			return null;
		}
	}

	/**
	 * Fetch similar incidents via oRPC API
	 */
	async fetchSimilarIncidents(
		request: SimilarIncidentRequest,
	): Promise<SimilarIncidentResponse> {
		try {
			// Fetch resolved/closed incidents from the same service
			const incidents = await api.incidents.list({
				serviceId: request.serviceId,
				status: "resolved",
				limit: request.limit || 10,
			});

			// Filter out the current incident and map to SimilarIncidentMatch
			const similarIncidents: SimilarIncidentMatch[] = incidents
				.filter((inc: { id: string }) => inc.id !== request.incidentId)
				.map((inc: Record<string, unknown>) => this.mapToSimilarIncident(inc));

			return { incidents: similarIncidents };
		} catch (error) {
			this.logger.warn("Failed to fetch similar incidents", { error });
			return { incidents: [] };
		}
	}

	/**
	 * Map API alert response to AlertContext
	 */
	private mapAlertToContext(alert: Record<string, unknown>): AlertContext {
		return {
			alertId: alert.id as string,
			title: (alert.title as string) || "Unknown Alert",
			description: alert.description as string | undefined,
			severity: (alert.severity as AlertContext["severity"]) || "medium",
			status: alert.status as AlertContext["status"],
			source: alert.source as string | undefined,
			sourceUrl: alert.sourceUrl as string | undefined,
			serviceId: alert.serviceId as string | undefined,
			serviceName: alert.serviceName as string | undefined,
			repository: alert.repository as string | undefined,
			labels: alert.labels as Record<string, string> | undefined,
			tags: alert.tags as string[] | undefined,
			triggeredAt: (alert.triggeredAt as string) || new Date().toISOString(),
			rawPayload: alert.rawPayload as Record<string, unknown> | undefined,
		};
	}

	/**
	 * Map API incident response to IncidentContext
	 */
	private mapIncidentToContext(
		incident: Record<string, unknown>,
	): IncidentContext {
		return {
			incidentId: incident.id as string,
			number: (incident.number as number) || 0,
			title: (incident.title as string) || "Unknown Incident",
			description: incident.description as string | undefined,
			severity: (incident.severity as IncidentContext["severity"]) || "medium",
			status:
				(incident.status as IncidentContext["status"]) || "investigating",
			priority: (incident.priority as IncidentContext["priority"]) || "p3",
			serviceId: incident.serviceId as string | undefined,
			serviceName: incident.serviceName as string | undefined,
			alertCount: (incident.alertCount as number) || 0,
			triggeredAt: (incident.triggeredAt as string) || new Date().toISOString(),
			acknowledgedAt: incident.acknowledgedAt as string | undefined,
			tags: incident.tags as string[] | undefined,
			customerImpact: incident.customerImpact as string | undefined,
			affectedSystems: incident.affectedSystems as string[] | undefined,
		};
	}

	/**
	 * Map API incident to SimilarIncidentMatch.
	 * Includes description, tags, and severity for similarity scoring.
	 */
	private mapToSimilarIncident(
		incident: Record<string, unknown>,
	): SimilarIncidentMatch {
		return {
			incidentId: incident.id as string,
			number: incident.number as number | undefined,
			title: (incident.title as string) || "Unknown Incident",
			description: incident.description as string | undefined,
			severity: incident.severity as string | undefined,
			tags: incident.tags as string[] | undefined,
			serviceId: incident.serviceId as string | undefined,
			serviceName: incident.serviceName as string | undefined,
			rootCause: incident.rootCause as string | undefined,
			rootCauseCategory: incident.rootCauseCategory as string | undefined,
			resolution: incident.resolution as string | undefined,
			resolvedAt: incident.resolvedAt as string | undefined,
			timeToResolve: incident.timeToResolve as number | undefined,
			postmortemSummary: incident.postmortemSummary as string | undefined,
			similarity: 0, // Computed by pre-gathering's calculateIncidentSimilarity
		};
	}
}

// Module-level singletons (order matters: logger before functions that use it)
const logger = new Logger({ context: "InvestigationProcessor" });
const dataProvider = new WorkerDataProvider();

// Lazy executor init — PostgresSaver.setup() is async, so we can't create at module level.
// Uses promise-based mutex to prevent duplicate initialization from concurrent jobs.
let _executorPromise: Promise<InvestigationExecutor> | null = null;

function getExecutor(): Promise<InvestigationExecutor> {
	if (!_executorPromise) {
		_executorPromise = initExecutor();
	}
	return _executorPromise;
}

async function initExecutor(): Promise<InvestigationExecutor> {
	const dbConfig = databaseSchema.parse(process.env);
	const connectionString = buildCheckpointerUrl(dbConfig);
	const schema = dbConfig.PRISMALENS_DB_TYPE === "postgresql"
		? getCheckpointerSchema(dbConfig)
		: undefined;

	const checkpointer = await createCheckpointer({
		dbType: dbConfig.PRISMALENS_DB_TYPE,
		connectionString,
		schema,
	});

	return new InvestigationExecutor({ dataProvider, checkpointer });
}

// Redis publisher for streaming events to API
const redisPublisher = new Redis(redisUrl, {
	maxRetriesPerRequest: null,
});

/** Node-to-percent mapping for BullMQ job progress reporting */
const NODE_PROGRESS: Record<string, number> = {
	scout: 10,
	analyst: 30,
	gatherer: 50,
	resolver: 75,
	supervisor: 90,
};

/**
 * Fetch integration credentials on-demand via internal API.
 * Worker passes connectionIds → API decrypts and returns IntegrationContext[].
 * SECURITY: Credentials only exist in-memory during execution, never in Redis.
 */
async function fetchIntegrationCredentials(
	connectionIds: string[],
): Promise<IntegrationWithCredentials[]> {
	if (connectionIds.length === 0) return [];

	const internalSecret = process.env.PRISMALENS_INTERNAL_SECRET;
	if (!internalSecret) {
		logger.warn("PRISMALENS_INTERNAL_SECRET not set — cannot fetch integration credentials");
		return [];
	}

	const url = new URL("/internal/integrations/credentials", workerConfig.PRISMALENS_WORKER_API_URL);
	url.searchParams.set("connectionIds", connectionIds.join(","));

	const response = await fetch(url.toString(), {
		headers: {
			"X-Internal-Secret": internalSecret,
			"User-Agent": "prismalens-worker/0.1.0",
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		logger.error("Failed to fetch integration credentials", {
			status: response.status,
			statusText: response.statusText,
		});
		return [];
	}

	const data = (await response.json()) as Array<{
		type: string;
		connectionId: string;
		credentials: Record<string, unknown>;
		config: Record<string, unknown>;
	}>;

	return data.map((item) => ({
		id: item.connectionId,
		name: item.type,
		type: item.type,
		enabled: true,
		config: item.config,
		credentials: item.credentials,
	}));
}

/**
 * Process an investigation job from the queue.
 *
 * Flow:
 * 1. Update investigation status to 'running'
 * 2. Add timeline entry
 * 3. Run investigation via InvestigationExecutor
 * 4. Submit results to API
 */
export async function processInvestigationJob(
	job: Job<InvestigationJobData>,
): Promise<InvestigationResult> {
	const { data } = job;

	// Wrap job processing in a wide event context
	return runWithWideEvent(
		`job-${job.id}`,
		async () => processJobInternal(job, data),
		{
			context: {
				job_id: job.id,
				job_name: job.name,
				investigation_id: data.investigationId,
				incident_id: data.incidentId,
			},
		},
	);
}

/**
 * Internal job processing logic.
 */
async function processJobInternal(
	job: Job<InvestigationJobData>,
	data: InvestigationJobData,
): Promise<InvestigationResult> {
	logger.info(`Processing job ${job.id} for investigation ${data.investigationId}`);

	// Enrich with job context
	enrichContext({
		context: {
			alert_count: data.alerts?.length ?? 0,
			connection_count: data.connectionIds?.length ?? 0,
			priority: data.priority,
		},
	});

	try {
		// 1. Generate thread ID and update status to running
		const threadId = crypto.randomUUID();
		await api.investigations.updateStatus({
			id: data.investigationId,
			status: "running",
			langGraphThreadId: threadId,
		});

		// 2. Add timeline entry
		await api.timeline.create({
			incidentId: data.incidentId,
			type: "investigation_started",
			title: "AI Investigation Started",
			description: "Starting automated multi-agent investigation",
			source: "ai_worker",
			metadata: { investigationId: data.investigationId },
		});

		// 3. Build input for executor (async - fetches incident)
		const executor = await getExecutor();
		const input = await buildExecutorInput(data);

		await job.updateProgress({
			percent: 5,
			message: "Starting investigation...",
		});

		// 4. Stream investigation via executor, publishing events to Redis
		const channel = `investigation:events:${data.investigationId}`;
		let agentResult: AgentResult | null = null;
		const tracker = new ExecutionTracker();

		for await (const chunk of executor.stream(input, { configurable: { thread_id: threadId } })) {
			// Publish raw tuple to Redis for API relay
			await redisPublisher.publish(channel, JSON.stringify(chunk));

			// Extract progress info for BullMQ job progress reporting
			const [mode, eventData] = chunk as [string, Record<string, unknown>];

			// "tasks" mode — track agent execution timing
			if (mode === "tasks") {
				const taskId = eventData?.id as string | undefined;
				const name = eventData?.name as string | undefined;
				if (taskId && name && !eventData?.result) {
					tracker.onTaskStart(taskId, name);
				}
				if (taskId && eventData?.result) {
					tracker.onTaskComplete(taskId, eventData?.error as string | undefined);
					if (name) {
						const percent = NODE_PROGRESS[name] ?? 50;
						await job.updateProgress({ percent, message: `${name} completed` });
					}
				}
			}

			// Extract final result from "updates" mode
			if (mode === "updates" && eventData) {
				for (const nodeUpdate of Object.values(eventData)) {
					const update = nodeUpdate as Record<string, unknown>;
					if (update?.result) {
						agentResult = update.result as AgentResult;
					}
				}
			}
		}

		// Signal stream completion to Redis
		await redisPublisher.publish(channel, JSON.stringify(["__done__", {}]));

		// If no result from stream, fall back to execute()
		if (!agentResult) {
			logger.warn(`Stream finished without result for job ${job.id}, using execute() fallback`);
			agentResult = await executor.execute(input, { configurable: { thread_id: threadId } });
		}

		await job.updateProgress({ percent: 90, message: "Persisting results..." });

		// 5. Submit results to API (with tracked agent executions)
		const result = buildResult(data, agentResult);
		const trackedExecutions = tracker.getExecutions();

		await api.investigations.writeResult({
			id: data.investigationId,
			status: result.success ? "completed" : "failed",
			summary: result.findings.summary,
			rootCause: result.findings.rootCause,
			rootCauseCategory: agentResult.rootCauseCategory ?? undefined,
			confidence: result.findings.confidence,
			dataQuality: result.findings.dataQuality,
			dataSourcesUsed: result.findings.dataSourcesUsed,
			error: result.error,
			agentExecutions: trackedExecutions.map((exec) => ({
				agentName: exec.agentName,
				status: exec.status,
				startedAt: exec.startedAt,
				completedAt: exec.completedAt,
				executionTimeMs: exec.executionTimeMs,
				error: exec.error,
			})),
			recommendations: result.recommendations.map((rec) => ({
				title: rec.title,
				description: rec.description,
				priority: rec.priority,
				category: rec.category,
				urgency: rec.urgency,
				actionable: rec.actionable,
				estimatedEffort: rec.estimatedEffort,
			})),
		});

		await job.updateProgress({
			percent: 100,
			message: "Investigation complete",
		});

		logger.info(`Job ${job.id} completed`, { success: result.success });

		return result;
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Job failed: ${errorMessage}`, error);

		// Update status to failed
		try {
			await api.investigations.updateStatus({
				id: data.investigationId,
				status: "failed",
				error: errorMessage,
			});

			// Add failure timeline entry
			await api.timeline.create({
				incidentId: data.incidentId,
				type: "investigation_completed",
				title: "AI Investigation Failed",
				description: errorMessage,
				source: "ai_worker",
				metadata: {
					investigationId: data.investigationId,
					error: errorMessage,
				},
			});
		} catch (e) {
			logger.error(`Failed to update failure status`, e);
		}

		throw error;
	}
}

/**
 * Build executor input from job data.
 * Now async to fetch incident context.
 */
async function buildExecutorInput(jobData: InvestigationJobData): Promise<InvestigationInput> {
	// Fetch incident context via API - REQUIRED for investigation
	const incidentData = await dataProvider.fetchIncident(jobData.incidentId);
	if (!incidentData) {
		throw new Error(`Incident not found: ${jobData.incidentId}`);
	}

	// Convert alerts from job data to AlertContext
	const alerts: AlertContext[] = (jobData.alerts || []).map((alertUnknown) => {
		const alert = alertUnknown as Record<string, unknown>;
		const labels = alert.labels as Record<string, string> | undefined;
		return {
			alertId:
				(alert.id as string) ||
				(alert.alertId as string) ||
				`alert-${Date.now()}`,
			title:
				(alert.title as string) ||
				(alert.alertname as string) ||
				"Unknown Alert",
			description:
				(alert.description as string | undefined) ||
				(alert.summary as string | undefined),
			severity: mapSeverity((alert.severity as string) || labels?.severity),
			status: alert.status as AlertContext["status"],
			source: (alert.source as string) || labels?.source,
			sourceUrl: (alert.sourceUrl as string) || (alert.generatorURL as string),
			serviceId: alert.serviceId as string | undefined,
			serviceName: (alert.serviceName as string) || labels?.service,
			repository: (alert.repository as string) || labels?.repository,
			labels,
			tags: alert.tags as string[] | undefined,
			triggeredAt: (alert.triggeredAt as string) || (alert.startsAt as string),
			rawPayload: alert,
		};
	});

	// Fetch integration credentials on-demand via internal API.
	// Queue mode passes connectionIds (not decrypted credentials) in the BullMQ payload.
	const integrations: IntegrationWithCredentials[] = await fetchIntegrationCredentials(
		jobData.connectionIds ?? [],
	);

	// Build LLM config from environment — API key resolved by LLM factory from process.env
	const config: InvestigationConfig = {
		llm: {
			provider: (process.env.LLM_PROVIDER as "anthropic" | "openai" | "ollama") || "anthropic",
			model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
		},
	};

	return {
		investigationId: jobData.investigationId,
		incidentId: jobData.incidentId,
		config,
		integrations,
	};
}

/**
 * Build result from agent result.
 */
function buildResult(
	jobData: InvestigationJobData,
	agentResult: AgentResult,
): InvestigationResult {
	const success = agentResult.status === "completed" && !agentResult.error;

	return {
		success,
		investigationId: jobData.investigationId,
		incidentId: jobData.incidentId,
		findings: {
			rootCause: agentResult.rootCause || undefined,
			summary: agentResult.summary || undefined,
			confidence: agentResult.confidence || undefined,
			dataSourcesUsed: [], // TODO(Phase-5C-2): populate from InvestigationResult.dataSourcesUsed
			dataQuality: {}, // TODO(Phase-5C-2): populate from InvestigationResult.dataQuality
		},
		recommendations: agentResult.recommendations.map((rec: Recommendation) => ({
			title: rec.title,
			description: rec.description,
			priority: rec.priority,
			category: rec.category ?? "investigation",
			urgency: rec.urgency,
			actionable: rec.actionable ?? true,
			estimatedEffort: rec.estimatedEffort,
		})),
		agentExecutions: [], // Agent executions are tracked internally by the executor
		error: agentResult.error || undefined,
	};
}

/**
 * Graceful shutdown - close executor and Redis publisher connections
 */
export async function closeProcessor(): Promise<void> {
	if (_executorPromise) {
		const executor = await _executorPromise;
		await executor.close();
	}
	await redisPublisher.quit();
}
