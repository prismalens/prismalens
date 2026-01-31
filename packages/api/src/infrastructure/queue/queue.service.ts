import {
	forwardRef,
	Inject,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	type IntegrationContext as AgentIntegrationContext,
	type AlertContext,
	InvestigationExecutor,
	type InvestigationInput,
	type InvestigationResult,
} from "@prismalens/agents";
import { EnvironmentVariables } from "@prismalens/config";
import type { ConnectionOptions } from "bullmq";
import { Queue, QueueEvents } from "bullmq";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import type { InvestigationResultDto } from "../../modules/investigations/dto/investigation-result.dto.js";

/**
 * Integration context for worker (matches worker IntegrationContext)
 */
export interface IntegrationContext {
	type: string;
	connectionId: string;
	credentials: Record<string, unknown>;
	config: Record<string, unknown>;
	serviceOverrides?: Record<string, unknown>;
}

/**
 * Job data for investigation queue (incident-centric)
 */
export interface InvestigationJobData {
	incidentId: string;
	investigationId: string;
	priority?: "low" | "normal" | "high" | "critical";
	context?: Record<string, unknown>;
	integrations?: IntegrationContext[];
	incidentData?: Record<string, unknown>;
	alerts?: unknown[];
}

/**
 * Result returned by investigation worker
 */
export interface InvestigationJobResult {
	success: boolean;
	investigationId: string;
	summary?: string;
	rootCause?: string;
	recommendations?: unknown[];
	error?: string;
}

/**
 * Queue service with dual-mode support:
 * - regular mode: Direct execution via @prismalens/agents (no Redis)
 * - queue mode: BullMQ queue with Redis (separate worker process)
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(QueueService.name);
	private readonly workerMode: "regular" | "queue";

	// Regular mode: agent executor
	private executor: InvestigationExecutor | null = null;

	// Queue mode resources (only initialized in queue mode)
	private investigationQueue: Queue<
		InvestigationJobData,
		InvestigationJobResult
	> | null = null;
	private queueEvents: QueueEvents | null = null;
	private connection: ConnectionOptions | null = null;

	constructor(
		private configService: ConfigService<EnvironmentVariables>,
		@Inject(forwardRef(() => InvestigationsService))
		private investigationsService: InvestigationsService,
	) {
		const config = this.configService.get("PRISMALENS_MODE");
		this.workerMode = config;
	}

	async onModuleInit() {
		if (this.workerMode === "regular") {
			this.logger.log(
				"Regular mode: Investigations will run directly via @prismalens/agents",
			);
			this.executor = new InvestigationExecutor({
				onProgress: async (investigationId, progress) => {
					this.logger.debug(
						`[${investigationId}] ${progress.phase}: ${progress.message}`,
					);
				},
			});
			return;
		}

		// Queue mode: Initialize BullMQ
		this.logger.log("Queue mode: Initializing BullMQ queue");

		try {
			// Build Redis URL from config
			const redisUrl = this.buildRedisUrl();
			this.connection = { url: redisUrl };

			this.investigationQueue = new Queue<
				InvestigationJobData,
				InvestigationJobResult
			>("investigation", {
				connection: this.connection,
				defaultJobOptions: {
					attempts: 3,
					backoff: {
						type: "exponential",
						delay: 1000,
					},
					removeOnComplete: {
						count: 100,
						age: 24 * 60 * 60, // 24 hours
					},
					removeOnFail: {
						count: 50,
						age: 7 * 24 * 60 * 60, // 7 days
					},
				},
			});

			this.queueEvents = new QueueEvents("investigation", {
				connection: this.connection,
			});

			// Log queue events
			this.queueEvents.on("completed", ({ jobId }) => {
				this.logger.log(`Investigation job ${jobId} completed`);
			});

			this.queueEvents.on("failed", ({ jobId, failedReason }) => {
				this.logger.error(`Investigation job ${jobId} failed: ${failedReason}`);
			});

			this.logger.log("Queue service initialized with Redis");
		} catch (error) {
			this.logger.error(
				`Failed to initialize queue: ${(error as Error).message}`,
			);
		}
	}

	private buildRedisUrl(): string {
		const PRISMALENS_REDIS_HOST = this.configService.get<EnvironmentVariables>(
			"PRISMALENS_REDIS_HOST",
		);
		const PRISMALENS_REDIS_PASSWORD =
			this.configService.get<EnvironmentVariables>("PRISMALENS_REDIS_PASSWORD");
		const PRISMALENS_REDIS_PORT = this.configService.get<EnvironmentVariables>(
			"PRISMALENS_REDIS_PORT",
		);
		const PRISMALENS_REDIS_DB = this.configService.get<EnvironmentVariables>(
			"PRISMALENS_REDIS_DB",
		);
		const auth = PRISMALENS_REDIS_PASSWORD
			? `:${PRISMALENS_REDIS_PASSWORD}@`
			: "";
		return `redis://${auth}${PRISMALENS_REDIS_HOST}:${PRISMALENS_REDIS_PORT}/${PRISMALENS_REDIS_DB}`;
	}

	async onModuleDestroy() {
		// Close executor connections (regular mode)
		if (this.executor) {
			await this.executor.close();
		}
		// Close queue connections (queue mode)
		if (this.queueEvents) {
			await this.queueEvents.close();
		}
		if (this.investigationQueue) {
			await this.investigationQueue.close();
		}
	}

	/**
	 * Check if job dispatching is available.
	 * - Regular mode: Always true (direct execution)
	 * - Queue mode: True if Redis queue is initialized
	 */
	isEnabled(): boolean {
		if (this.workerMode === "regular") {
			return this.executor !== null;
		}
		return this.investigationQueue !== null;
	}

	/**
	 * Get the current worker mode.
	 */
	getWorkerMode(): "regular" | "queue" {
		return this.workerMode;
	}

	/**
	 * Add an investigation job.
	 * - Regular mode: Execute directly via @prismalens/agents
	 * - Queue mode: Adds to BullMQ queue
	 */
	async addInvestigationJob(
		data: InvestigationJobData,
	): Promise<string | null> {
		if (this.workerMode === "regular") {
			return this.executeDirectly(data);
		}

		return this.enqueueToRedis(data);
	}

	/**
	 * Execute investigation directly using @prismalens/agents (regular mode).
	 * This runs the investigation in-process without requiring a separate worker.
	 */
	private async executeDirectly(
		data: InvestigationJobData,
	): Promise<string | null> {
		if (!this.executor) {
			this.logger.error("Executor not initialized");
			return null;
		}

		const jobId = `direct-${data.investigationId}`;

		try {
			this.logger.log(
				`Executing investigation ${jobId} directly via @prismalens/agents`,
			);

			// Build input for executor
			const input = this.buildExecutorInput(data);

			// Execute in the background - don't block the HTTP response
			// Persist results to database when complete (like worker does)
			this.executor.execute(input).then(
				(result: InvestigationResult) => {
					this.logger.log(
						`Investigation ${jobId} completed: ${result.status}, confidence: ${result.confidence}%`,
					);
					// Persist results to database
					this.persistResults(data, result);
				},
				(error: Error) => {
					this.logger.error(`Investigation ${jobId} failed: ${error.message}`);
					// Persist failure to database
					this.persistFailure(data, error);
				},
			);

			this.logger.log(`Investigation ${jobId} started successfully`);
			return jobId;
		} catch (error) {
			const err = error as Error;
			this.logger.error(`Failed to start investigation: ${err.message}`);
			return null;
		}
	}

	/**
	 * Build executor input from job data.
	 */
	private buildExecutorInput(
		jobData: InvestigationJobData,
	): InvestigationInput {
		// Convert alerts from job data to AlertContext
		const alerts: AlertContext[] = (jobData.alerts || []).map(
			(alertUnknown) => {
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
					severity: this.mapSeverity(
						(alert.severity as string) || labels?.severity,
					),
					status: alert.status as AlertContext["status"],
					source: (alert.source as string) || labels?.source,
					sourceUrl:
						(alert.sourceUrl as string) || (alert.generatorURL as string),
					serviceId: alert.serviceId as string | undefined,
					serviceName: (alert.serviceName as string) || labels?.service,
					repository: (alert.repository as string) || labels?.repository,
					labels,
					tags: alert.tags as string[] | undefined,
					triggeredAt:
						(alert.triggeredAt as string) || (alert.startsAt as string),
					rawPayload: alert,
				};
			},
		);

		// Convert integrations
		const integrations: AgentIntegrationContext[] = (
			jobData.integrations || []
		).map((int) => ({
			type: int.type,
			connectionId: int.connectionId,
			credentials: int.credentials,
			config: int.config,
			serviceOverrides: int.serviceOverrides,
		}));

		return {
			investigationId: jobData.investigationId,
			incidentId: jobData.incidentId,
			priority: jobData.priority,
			alerts,
			integrations,
		};
	}

	/**
	 * Map various severity formats to standard format.
	 */
	private mapSeverity(
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
	 * Enqueue job to Redis via BullMQ (queue mode).
	 */
	private async enqueueToRedis(
		data: InvestigationJobData,
	): Promise<string | null> {
		if (!this.investigationQueue) {
			this.logger.warn("Queue not available - job not added");
			return null;
		}

		const priority = this.getPriorityValue(data.priority);

		const job = await this.investigationQueue.add("investigate", data, {
			priority,
			jobId: `investigation-${data.investigationId}`,
		});

		this.logger.log(
			`Added investigation job ${job.id} for incident ${data.incidentId}`,
		);

		return job.id ?? null;
	}

	/**
	 * Get status of a job by ID.
	 * Only available in queue mode.
	 */
	async getJobStatus(jobId: string): Promise<{
		status: string;
		progress: number;
		result?: InvestigationJobResult;
	} | null> {
		if (this.workerMode === "regular") {
			// In regular mode, job status is tracked via database
			// not in-memory (investigation runs async)
			this.logger.debug(
				"Job status not available in regular mode - check database",
			);
			return null;
		}

		if (!this.investigationQueue) {
			return null;
		}

		const job = await this.investigationQueue.getJob(jobId);

		if (!job) {
			return null;
		}

		const state = await job.getState();
		const progress = job.progress as number;

		return {
			status: state,
			progress: typeof progress === "number" ? progress : 0,
			result: job.returnvalue ?? undefined,
		};
	}

	/**
	 * Get queue statistics.
	 * Only available in queue mode.
	 */
	async getQueueStats(): Promise<{
		waiting: number;
		active: number;
		completed: number;
		failed: number;
	} | null> {
		if (this.workerMode === "regular") {
			// In regular mode, queue stats are not available
			return null;
		}

		if (!this.investigationQueue) {
			return null;
		}

		const [waiting, active, completed, failed] = await Promise.all([
			this.investigationQueue.getWaitingCount(),
			this.investigationQueue.getActiveCount(),
			this.investigationQueue.getCompletedCount(),
			this.investigationQueue.getFailedCount(),
		]);

		return { waiting, active, completed, failed };
	}

	private getPriorityValue(priority?: string): number {
		switch (priority) {
			case "critical":
				return 1;
			case "high":
				return 2;
			case "normal":
				return 3;
			case "low":
				return 4;
			default:
				return 3;
		}
	}

	// =========================================================================
	// RESULT PERSISTENCE (Regular Mode)
	// =========================================================================
	// These methods persist investigation results to the database when running
	// in regular mode. This mirrors the behavior of packages/worker in queue mode.
	// =========================================================================

	/**
	 * Persist investigation results to database (regular mode).
	 * Mirrors the behavior of packages/worker which uses oRPC to persist results.
	 */
	private async persistResults(
		data: InvestigationJobData,
		result: InvestigationResult,
	): Promise<void> {
		try {
			// Map agent result to API DTO format
			const resultDto: InvestigationResultDto = {
				summary: result.summary ?? undefined,
				rootCause: result.rootCause ?? undefined,
				rootCauseCategory: result.rootCauseCategory ?? undefined,
				confidence:
					result.confidence !== null ? result.confidence / 100 : undefined, // Convert 0-100 to 0-1
				analysisMethod: result.analysisMethod ?? undefined,
				error: result.error ?? undefined,
				recommendations: result.recommendations.map((rec) => ({
					title: rec.title,
					description: rec.description,
					priority: rec.priority,
					category: rec.category,
					urgency: rec.urgency,
				})),
			};

			// Use the investigations service to persist results
			await this.investigationsService.setResult(data.investigationId, resultDto);

			this.logger.log(
				`Persisted results for investigation ${data.investigationId}`,
			);
		} catch (error) {
			const err = error as Error;
			this.logger.error(
				`Failed to persist results for investigation ${data.investigationId}: ${err.message}`,
			);
		}
	}

	/**
	 * Persist investigation failure to database (regular mode).
	 */
	private async persistFailure(
		data: InvestigationJobData,
		error: Error,
	): Promise<void> {
		try {
			// Update status to failed with error message
			await this.investigationsService.updateStatusInternal(
				data.investigationId,
				"failed",
				undefined,
				error.message,
			);

			this.logger.log(
				`Persisted failure for investigation ${data.investigationId}`,
			);
		} catch (e) {
			const err = e as Error;
			this.logger.error(
				`Failed to persist failure for investigation ${data.investigationId}: ${err.message}`,
			);
		}
	}
}
