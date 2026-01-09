import {
	closeCheckpointer,
	hasExistingCheckpoint,
	resumeInvestigation,
	runInvestigation,
} from "../graph/index.js";
import type {
	AlertContext,
	Hypothesis,
	IntegrationContext,
	InvestigationState,
	Recommendation,
} from "../types/index.js";
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
	/** Priority level */
	priority?: "low" | "normal" | "high" | "critical";
	/** Alerts to investigate */
	alerts: AlertContext[];
	/** Available integrations for tools */
	integrations?: IntegrationContext[];
	/** Maximum iterations before stopping */
	maxIterations?: number;
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
 * Investigation Executor - Main interface for running investigations
 *
 * @example
 * ```typescript
 * // In packages/api (regular mode)
 * const executor = new InvestigationExecutor();
 * const result = await executor.execute({
 *   investigationId: 'inv-123',
 *   incidentId: 'inc-456',
 *   alerts: [...],
 *   integrations: [...],
 * });
 *
 * // In packages/worker (queue mode)
 * const executor = new InvestigationExecutor({
 *   onProgress: async (id, progress) => {
 *     await job.updateProgress(progress);
 *   },
 * });
 * ```
 */
export class InvestigationExecutor {
	private callbacks: InvestigationCallbacks;
	private tracker: ExecutionTracker;

	constructor(callbacks: InvestigationCallbacks = {}) {
		this.callbacks = callbacks;
		this.tracker = new ExecutionTracker();
	}

	/**
	 * Execute an investigation
	 */
	async execute(input: InvestigationInput): Promise<InvestigationResult> {
		const startTime = Date.now();

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
				state = await resumeInvestigation(input.investigationId);
			} else {
				await this.callbacks.onProgress?.(input.investigationId, {
					phase: "running",
					message: "Running investigation",
				});
				state = await runInvestigation({
					investigationId: input.investigationId,
					incidentId: input.incidentId,
					priority: input.priority || "normal",
					alerts: input.alerts,
					integrations: input.integrations || [],
					maxIterations: input.maxIterations || 10,
				});
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
	 */
	async resume(investigationId: string): Promise<InvestigationResult> {
		const startTime = Date.now();

		try {
			await this.callbacks.onStart?.(investigationId);
			await this.callbacks.onProgress?.(investigationId, {
				phase: "resuming",
				message: "Resuming investigation",
			});

			const state = await resumeInvestigation(investigationId);
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

/**
 * Create a singleton executor instance
 */
let defaultExecutor: InvestigationExecutor | null = null;

export function getDefaultExecutor(): InvestigationExecutor {
	if (!defaultExecutor) {
		defaultExecutor = new InvestigationExecutor();
	}
	return defaultExecutor;
}

/**
 * Execute an investigation using the default executor
 */
export async function executeInvestigation(
	input: InvestigationInput,
): Promise<InvestigationResult> {
	return getDefaultExecutor().execute(input);
}
