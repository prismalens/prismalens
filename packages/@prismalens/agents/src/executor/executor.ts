import {
	closeCheckpointer,
	hasExistingCheckpoint,
	resumeInvestigation,
	runInvestigation,
} from "../graph/index.js";
import type {
	AlertContext,
	DataProvider,
	Hypothesis,
	IncidentContext,
	IntegrationContext,
	InvestigationState,
	Recommendation,
} from "../types/index.js";
import type { InvestigationConfig } from "../types/config.js";
import { ExecutionTracker } from "./callbacks.js";

// =============================================================================
// INVESTIGATION EXECUTOR
// =============================================================================
// Provides a clean interface for running investigations.
// Used by both packages/api (regular mode) and packages/worker (queue mode).
// =============================================================================

/**
 * Input parameters for starting an investigation
 */
export interface InvestigationInput {
	/** Unique investigation ID */
	investigationId: string;
	/** Incident ID this investigation belongs to */
	incidentId: string;
	/** Incident context - REQUIRED for investigation validation */
	incident: IncidentContext;
	/** Priority level */
	priority?: "low" | "normal" | "high" | "critical";
	/** Alerts to investigate */
	alerts: AlertContext[];
	/** Available integrations for tools */
	integrations?: IntegrationContext[];
	/** Maximum iterations before stopping */
	maxIterations?: number;
	/**
	 * LLM configuration for agents.
	 * REQUIRED - must be provided by the caller.
	 */
	llmConfig: InvestigationConfig["llmConfig"];
}

/**
 * Result of an investigation
 */
export interface InvestigationResult {
	/** Investigation ID */
	investigationId: string;
	/** Final status */
	status: "completed" | "failed";
	/** Executive summary */
	summary: string | null;
	/** Root cause description */
	rootCause: string | null;
	/** Root cause category */
	rootCauseCategory:
		| "code"
		| "config"
		| "infrastructure"
		| "external"
		| "unknown"
		| null;
	/** Confidence score (0-100) */
	confidence: number | null;
	/** Formed hypotheses */
	hypotheses: Hypothesis[];
	/** Actionable recommendations */
	recommendations: Recommendation[];
	/** Error message if failed */
	error: string | null;
	/** Total execution time in milliseconds */
	executionTimeMs: number;
	/** Analysis method used */
	analysisMethod: string | null;
}

/**
 * Callbacks for investigation progress events
 */
export interface InvestigationCallbacks {
	/** Called when investigation starts */
	onStart?: (investigationId: string) => void | Promise<void>;
	/** Called when investigation completes */
	onComplete?: (result: InvestigationResult) => void | Promise<void>;
	/** Called when investigation fails */
	onError?: (investigationId: string, error: Error) => void | Promise<void>;
	/** Called on progress updates */
	onProgress?: (
		investigationId: string,
		progress: {
			phase: string;
			message: string;
		},
	) => void | Promise<void>;
}

/**
 * Options for creating an InvestigationExecutor
 */
export interface InvestigationExecutorOptions {
	/**
	 * Data provider for fetching additional data during investigation.
	 * REQUIRED - agents need this to fetch alerts, incidents, etc.
	 */
	dataProvider: DataProvider;
	/**
	 * Optional callbacks for progress events
	 */
	callbacks?: InvestigationCallbacks;
}

/**
 * Investigation Executor - Main interface for running investigations
 *
 * @example
 * ```typescript
 * // In packages/api (regular mode)
 * const executor = new InvestigationExecutor({
 *   dataProvider: new DirectDataProvider(alertsService, incidentsService),
 *   callbacks: {
 *     onProgress: async (id, progress) => { ... },
 *   },
 * });
 * const result = await executor.execute({
 *   investigationId: 'inv-123',
 *   incidentId: 'inc-456',
 *   alerts: [...],
 *   integrations: [...],
 * });
 *
 * // In packages/worker (queue mode)
 * const executor = new InvestigationExecutor({
 *   dataProvider: new WorkerDataProvider(api),
 *   callbacks: {
 *     onProgress: async (id, progress) => {
 *       await job.updateProgress(progress);
 *     },
 *   },
 * });
 * ```
 */
export class InvestigationExecutor {
	private callbacks: InvestigationCallbacks;
	private dataProvider: DataProvider;
	private tracker: ExecutionTracker;

	constructor(options: InvestigationExecutorOptions) {
		if (!options.dataProvider) {
			throw new Error(
				"DataProvider is required. Provide a DataProvider implementation " +
				"(e.g., DirectDataProvider for API, WorkerDataProvider for worker)."
			);
		}
		this.dataProvider = options.dataProvider;
		this.callbacks = options.callbacks || {};
		this.tracker = new ExecutionTracker();
	}

	/**
	 * Execute an investigation
	 */
	async execute(input: InvestigationInput): Promise<InvestigationResult> {
		const startTime = Date.now();

		// Validate required config
		if (!input.llmConfig) {
			throw new Error(
				"llmConfig is required. Provide LLM configuration for agents.",
			);
		}

		// Build runtime config (NOT checkpointed)
		const config: InvestigationConfig = {
			llmConfig: input.llmConfig,
			integrations: input.integrations || [],
			maxIterations: input.maxIterations ?? 10,
			priority: input.priority ?? "normal",
		};

		try {
			// Notify start
			await this.callbacks.onStart?.(input.investigationId);
			await this.callbacks.onProgress?.(input.investigationId, {
				phase: "starting",
				message: "Investigation starting",
			});

			// Check if we can resume from checkpoint
			const canResume = await hasExistingCheckpoint(input.investigationId);

			let state: InvestigationState;
			if (canResume) {
				await this.callbacks.onProgress?.(input.investigationId, {
					phase: "resuming",
					message: "Resuming from checkpoint",
				});
				state = await resumeInvestigation(
					input.investigationId,
					this.dataProvider,
					config,
				);
			} else {
				await this.callbacks.onProgress?.(input.investigationId, {
					phase: "running",
					message: "Running investigation",
				});
				// Build initial state (only data, no config)
				const initialState = {
					investigationId: input.investigationId,
					incidentId: input.incidentId,
					incident: input.incident,
					alerts: input.alerts,
				};
				state = await runInvestigation(
					initialState,
					this.dataProvider,
					config,
				);
			}

			const executionTimeMs = Date.now() - startTime;

			const result: InvestigationResult = {
				investigationId: input.investigationId,
				status: state.status === "failed" ? "failed" : "completed",
				summary: state.summary,
				rootCause: state.rootCause,
				rootCauseCategory: state.rootCauseCategory,
				confidence: state.confidence,
				hypotheses: state.hypotheses,
				recommendations: state.recommendations,
				error: state.error,
				executionTimeMs,
				analysisMethod: state.analysisMethod,
			};

			// Notify completion
			await this.callbacks.onComplete?.(result);
			await this.callbacks.onProgress?.(input.investigationId, {
				phase: "completed",
				message: `Investigation completed in ${executionTimeMs}ms`,
			});

			return result;
		} catch (error) {
			const executionTimeMs = Date.now() - startTime;
			const err = error instanceof Error ? error : new Error(String(error));

			// Notify error
			await this.callbacks.onError?.(input.investigationId, err);
			await this.callbacks.onProgress?.(input.investigationId, {
				phase: "failed",
				message: err.message,
			});

			return {
				investigationId: input.investigationId,
				status: "failed",
				summary: null,
				rootCause: null,
				rootCauseCategory: null,
				confidence: null,
				hypotheses: [],
				recommendations: [],
				error: err.message,
				executionTimeMs,
				analysisMethod: null,
			};
		}
	}

	/**
	 * Resume a paused investigation
	 *
	 * @param investigationId - ID of the investigation to resume
	 * @param config - Runtime config (credentials, limits) - REQUIRED for resume
	 */
	async resume(
		investigationId: string,
		config: InvestigationConfig,
	): Promise<InvestigationResult> {
		const startTime = Date.now();

		try {
			await this.callbacks.onStart?.(investigationId);
			await this.callbacks.onProgress?.(investigationId, {
				phase: "resuming",
				message: "Resuming investigation",
			});

			const state = await resumeInvestigation(
				investigationId,
				this.dataProvider,
				config,
			);
			const executionTimeMs = Date.now() - startTime;

			const result: InvestigationResult = {
				investigationId,
				status: state.status === "failed" ? "failed" : "completed",
				summary: state.summary,
				rootCause: state.rootCause,
				rootCauseCategory: state.rootCauseCategory,
				confidence: state.confidence,
				hypotheses: state.hypotheses,
				recommendations: state.recommendations,
				error: state.error,
				executionTimeMs,
				analysisMethod: state.analysisMethod,
			};

			await this.callbacks.onComplete?.(result);
			return result;
		} catch (error) {
			const executionTimeMs = Date.now() - startTime;
			const err = error instanceof Error ? error : new Error(String(error));

			await this.callbacks.onError?.(investigationId, err);

			return {
				investigationId,
				status: "failed",
				summary: null,
				rootCause: null,
				rootCauseCategory: null,
				confidence: null,
				hypotheses: [],
				recommendations: [],
				error: err.message,
				executionTimeMs,
				analysisMethod: null,
			};
		}
	}

	/**
	 * Check if an investigation can be resumed
	 */
	async canResume(investigationId: string): Promise<boolean> {
		return hasExistingCheckpoint(investigationId);
	}

	/**
	 * Close any open connections (call during shutdown)
	 */
	async close(): Promise<void> {
		await closeCheckpointer();
	}
}

// Note: Singleton functions (getDefaultExecutor, executeInvestigation) removed.
// DataProvider is required, so callers must create their own executor instance
// with the appropriate DataProvider for their mode (direct or queue).
