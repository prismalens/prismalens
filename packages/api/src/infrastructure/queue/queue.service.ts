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
	InvestigationExecutor,
	type InvestigationInput,
	type InvestigationResult,
	type LLMProviderConfig,
} from "@prismalens/agents";
import { EnvironmentVariables } from "@prismalens/config";
import type { ConnectionOptions } from "bullmq";
import { Queue, QueueEvents } from "bullmq";
import { AlertsService } from "../../modules/alerts/alerts.service.js";
import { IncidentsService } from "../../modules/incidents/incidents.service.js";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import type { InvestigationResultDto } from "../../modules/investigations/dto/investigation-result.dto.js";
import { InvestigationSemaphore } from "./investigation-semaphore.js";
import { DirectDataProvider } from "./direct-data-provider.js";

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
 *
 * SECURITY: In queue mode, this payload is serialized to Redis.
 * Never include decrypted credentials. Use connectionIds instead,
 * and the worker fetches credentials on-demand via internal API.
 */
export interface InvestigationJobData {
	incidentId: string;
	investigationId: string;
	priority?: "low" | "normal" | "high" | "critical";
	context?: Record<string, unknown>;
	/** @deprecated Use connectionIds instead - credentials should not be in Redis */
	integrations?: IntegrationContext[];
	/** Connection IDs for integration credentials - worker fetches on-demand */
	connectionIds?: string[];
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

// =============================================================================
// QUEUE CONFIGURATION CONSTANTS
// =============================================================================

/** Maximum retry attempts for failed jobs */
const JOB_MAX_ATTEMPTS = 3;

/** Initial backoff delay in ms (exponential) */
const JOB_BACKOFF_DELAY_MS = 1000;

/** Keep last N completed jobs */
const COMPLETED_JOB_RETENTION_COUNT = 100;

/** Remove completed jobs older than 24 hours */
const COMPLETED_JOB_RETENTION_AGE_S = 24 * 60 * 60;

/** Keep last N failed jobs */
const FAILED_JOB_RETENTION_COUNT = 50;

/** Remove failed jobs older than 7 days */
const FAILED_JOB_RETENTION_AGE_S = 7 * 24 * 60 * 60;

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

	// Regular mode: concurrency control (optional)
	private semaphore: InvestigationSemaphore | null = null;

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
		@Inject(forwardRef(() => AlertsService))
		private alertsService: AlertsService,
		@Inject(forwardRef(() => IncidentsService))
		private incidentsService: IncidentsService,
	) {
		const config = this.configService.get("PRISMALENS_MODE");
		this.workerMode = config;
	}

	async onModuleInit() {
		if (this.workerMode === "regular") {
			this.logger.log(
				"Regular mode: Investigations will run directly via @prismalens/agents",
			);

			// Initialize concurrency control if configured
			const maxConcurrent = this.configService.get<number>(
				"PRISMALENS_MAX_CONCURRENT_INVESTIGATIONS",
			);
			if (maxConcurrent !== undefined && maxConcurrent > 0) {
				this.semaphore = new InvestigationSemaphore(maxConcurrent);
				this.logger.log(
					`Concurrency control enabled: max ${maxConcurrent} concurrent investigations`,
				);
			} else {
				this.logger.log(
					"Concurrency control disabled (unlimited concurrent investigations)",
				);
			}

			// Create executor with DirectDataProvider for database access
			const dataProvider = new DirectDataProvider(this.alertsService, this.incidentsService);
			this.executor = new InvestigationExecutor({ dataProvider });
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
					attempts: JOB_MAX_ATTEMPTS,
					backoff: {
						type: "exponential",
						delay: JOB_BACKOFF_DELAY_MS,
					},
					removeOnComplete: {
						count: COMPLETED_JOB_RETENTION_COUNT,
						age: COMPLETED_JOB_RETENTION_AGE_S,
					},
					removeOnFail: {
						count: FAILED_JOB_RETENTION_COUNT,
						age: FAILED_JOB_RETENTION_AGE_S,
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
	 *
	 * When semaphore is configured, execution is synchronous (awaited) to prevent
	 * in-memory queue buildup. Without semaphore, execution is fire-and-forget
	 * for immediate HTTP response.
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

			// If semaphore is configured, use controlled execution (awaited)
			if (this.semaphore) {
				// Run with semaphore control — awaited for backpressure
				await this.executeWithSemaphore(data, input, jobId);
			} else {
				// No semaphore: fire-and-forget execution with error boundary
				void (async () => {
					try {
						const result = await this.executor!.execute(input);
						this.logger.log(
							`Investigation ${jobId} completed: ${result.status}, confidence: ${result.confidence}%`,
						);
						await this.persistResults(data, result);
					} catch (error) {
						const err = error as Error;
						this.logger.error(`Investigation ${jobId} failed: ${err.message}`);
						await this.persistFailure(data, err);
					}
				})();
			}

			this.logger.log(`Investigation ${jobId} started successfully`);
			return jobId;
		} catch (error) {
			const err = error as Error;
			this.logger.error(`Failed to start investigation: ${err.message}`);
			return null;
		}
	}

	/**
	 * Execute investigation with semaphore control.
	 * Waits for a slot, runs the investigation, and releases the slot.
	 */
	private async executeWithSemaphore(
		data: InvestigationJobData,
		input: InvestigationInput,
		jobId: string,
	): Promise<void> {
		if (!this.semaphore || !this.executor) return;

		try {
			// Wait for a slot (may queue if at capacity)
			await this.semaphore.acquire(data.investigationId);

			this.logger.log(
				`Semaphore acquired for ${jobId}, executing...`,
			);

			// Execute and await completion
			const result = await this.executor.execute(input);
			this.logger.log(
				`Investigation ${jobId} completed: ${result.status}, confidence: ${result.confidence}%`,
			);
			await this.persistResults(data, result);
		} catch (error) {
			const err = error as Error;
			this.logger.error(`Investigation ${jobId} failed: ${err.message}`);
			await this.persistFailure(data, err);
		} finally {
			// Always release the slot
			this.semaphore.release();
			this.logger.debug(`Semaphore released for ${jobId}`);
		}
	}

	/**
	 * Build executor input from job data.
	 *
	 * Simplified: scout fetches incident + alerts via DataProvider at runtime.
	 * Only passes identifiers, config, and non-sensitive integration metadata.
	 */
	private buildExecutorInput(
		jobData: InvestigationJobData,
	): InvestigationInput {
		// Map integrations to agent IntegrationContext (non-sensitive metadata only)
		const integrations: AgentIntegrationContext[] = (
			jobData.integrations || []
		).map((int) => ({
			id: int.connectionId,
			name: int.type,
			type: int.type,
			enabled: true,
			config: int.config,
		}));

		// LLM config from env vars — API key resolved by LLM factory from process.env
		const provider = (process.env.PRISMALENS_LLM_PROVIDER || "anthropic") as LLMProviderConfig["provider"];
		const model = process.env.PRISMALENS_LLM_MODEL || "claude-sonnet-4-20250514";

		return {
			investigationId: jobData.investigationId,
			incidentId: jobData.incidentId,
			config: {
				llm: { provider, model },
			},
			integrations,
		};
	}

	/**
	 * Enqueue job to Redis via BullMQ (queue mode).
	 * SECURITY: Strips decrypted credentials from the payload.
	 * Passes connectionIds instead — worker fetches on-demand via internal API.
	 */
	private async enqueueToRedis(
		data: InvestigationJobData,
	): Promise<string | null> {
		if (!this.investigationQueue) {
			this.logger.warn("Queue not available - job not added");
			return null;
		}

		const priority = this.getPriorityValue(data.priority);

		// Strip credentials from payload — pass connectionIds only
		const { integrations, ...safeData } = data;
		const connectionIds = integrations?.map((i) => i.connectionId) ?? data.connectionIds ?? [];
		const jobPayload: InvestigationJobData = { ...safeData, connectionIds };

		const job = await this.investigationQueue.add("investigate", jobPayload, {
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

	/**
	 * Get semaphore status for regular mode.
	 * Returns null if semaphore is not configured.
	 */
	getSemaphoreStatus(): {
		running: number;
		queued: number;
		maxConcurrent: number;
		queuedInvestigations: Array<{ id: string; waitingMs: number }>;
	} | null {
		if (!this.semaphore) {
			return null;
		}
		return this.semaphore.getStatus();
	}

	/**
	 * Cancel a queued investigation (regular mode with semaphore only).
	 */
	cancelQueuedInvestigation(investigationId: string): boolean {
		if (!this.semaphore) {
			return false;
		}
		return this.semaphore.cancel(investigationId);
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
			const rootCauseCategory = result.rootCauseCategory as
				| InvestigationResultDto["rootCauseCategory"]
				| null;
			const resultDto: InvestigationResultDto = {
				summary: result.summary ?? undefined,
				rootCause: result.rootCause ?? undefined,
				rootCauseCategory: rootCauseCategory ?? undefined,
				confidence:
					result.confidence !== null ? result.confidence / 100 : undefined, // Convert 0-100 to 0-1
				analysisMethod: result.analysisMethod ?? undefined,
				error: result.error ?? undefined,
				recommendations: result.recommendations.map((rec) => ({
					title: rec.title,
					description: rec.description,
					priority: rec.priority,
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

