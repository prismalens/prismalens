import {
	type InvestigationResult as AgentResult,
	type AlertContext,
	type IntegrationContext,
	InvestigationExecutor,
	type InvestigationInput,
} from "@prismalens/agents";
import { Logger, enrichContext } from "@prismalens/logger";
import { runWithWideEvent } from "@prismalens/logger/standalone";
import type { Job } from "bullmq";
import { api } from "./orpc-client.js";
import type { InvestigationJobData, InvestigationResult } from "./types.js";

// =============================================================================
// INVESTIGATION JOB PROCESSOR
// =============================================================================
// Processes investigation jobs from the BullMQ queue.
// Uses the @prismalens/agents package for investigation execution.
// =============================================================================

// Create a singleton executor
const executor = new InvestigationExecutor();

// Create logger for processor
const logger = new Logger({ context: "InvestigationProcessor" });

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
			integration_count: data.integrations?.length ?? 0,
			priority: data.priority,
		},
	});

	try {
		// 1. Update status to running
		await api.investigations.updateStatus({
			id: data.investigationId,
			status: "running",
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

		// 3. Build input for executor
		const input = buildExecutorInput(data);

		await job.updateProgress({
			percent: 10,
			message: "Starting investigation...",
		});

		// 4. Run investigation via executor
		const agentResult = await executor.execute(input);

		await job.updateProgress({ percent: 90, message: "Persisting results..." });

		// 5. Submit results to API
		const result = buildResult(data, agentResult);

		await api.investigations.writeResult({
			id: data.investigationId,
			status: result.success ? "completed" : "failed",
			summary: result.findings.summary,
			rootCause: result.findings.rootCause,
			rootCauseCategory: agentResult.rootCauseCategory,
			confidence: result.findings.confidence,
			dataQuality: result.findings.dataQuality,
			agentProgression: result.findings.agentProgression,
			dataSourcesUsed: result.findings.dataSourcesUsed,
			analysisMethod: result.findings.analysisMethod,
			error: result.error,
			agentExecutions: [], // Agent executions are tracked internally
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
				type: "investigation_failed",
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
 */
function buildExecutorInput(jobData: InvestigationJobData): InvestigationInput {
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

	// Convert integrations
	const integrations: IntegrationContext[] = (jobData.integrations || []).map(
		(int) => ({
			type: int.type,
			connectionId: int.connectionId,
			credentials: int.credentials as Record<string, unknown>,
			config: int.config as Record<string, unknown>,
			serviceOverrides: int.serviceOverrides as
				| Record<string, unknown>
				| undefined,
		}),
	);

	return {
		investigationId: jobData.investigationId,
		incidentId: jobData.incidentId,
		priority: jobData.priority,
		alerts,
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
			analysisMethod: agentResult.analysisMethod || undefined,
			dataSourcesUsed: [], // TODO: Add to AgentResult if needed
			agentProgression: {}, // TODO: Add to AgentResult if needed
			dataQuality: {}, // TODO: Add to AgentResult if needed
		},
		recommendations: agentResult.recommendations.map((rec) => ({
			title: rec.title,
			description: rec.description,
			priority: rec.priority,
			category: rec.category,
			urgency: rec.urgency,
			actionable: rec.actionable,
			estimatedEffort: rec.estimatedEffort,
		})),
		agentExecutions: [], // Agent executions are tracked internally by the executor
		error: agentResult.error || undefined,
	};
}

/**
 * Map various severity formats to our standard format.
 */
function mapSeverity(
	severity: string | undefined,
): "critical" | "high" | "medium" | "low" | "info" {
	if (!severity) return "medium";

	const lower = severity.toLowerCase();

	if (lower === "critical" || lower === "crit" || lower === "p1") {
		return "critical";
	}
	if (
		lower === "high" ||
		lower === "error" ||
		lower === "p2" ||
		lower === "severe"
	) {
		return "high";
	}
	if (
		lower === "medium" ||
		lower === "warning" ||
		lower === "warn" ||
		lower === "p3"
	) {
		return "medium";
	}
	if (lower === "low" || lower === "minor" || lower === "p4") {
		return "low";
	}
	if (lower === "info" || lower === "informational" || lower === "p5") {
		return "info";
	}

	return "medium";
}

/**
 * Graceful shutdown - close executor connections
 */
export async function closeProcessor(): Promise<void> {
	await executor.close();
}
