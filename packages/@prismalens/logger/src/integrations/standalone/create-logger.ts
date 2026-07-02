import {
	enrichContext,
	getRequestId,
	getTraceId,
	runInRequestContext,
} from "../../core/context.js";
import { Logger } from "../../core/logger.js";
import type { ServiceInfo, WideEvent } from "../../types/wide-event.js";

/**
 * Options for creating a standalone logger.
 */
export interface StandaloneLoggerOptions {
	/** Service information */
	service: ServiceInfo;
	/** Logger context name */
	context?: string;
}

/**
 * Create a logger for non-NestJS contexts (Worker, Agents, CLI).
 *
 * @example
 * ```typescript
 * import { createLogger } from '@prismalens/logger/standalone';
 *
 * const logger = createLogger({
 *   service: {
 *     name: 'prismalens-worker',
 *     version: '1.0.0',
 *     environment: 'development',
 *   },
 *   context: 'Worker',
 * });
 *
 * logger.info('Worker started');
 * ```
 */
export function createLogger(options: StandaloneLoggerOptions): Logger {
	Logger.setServiceInfo(options.service);
	return new Logger({ context: options.context });
}

/**
 * Run a job/task within a wide event context.
 * Use this for background jobs, agent runs, etc.
 *
 * The wide event is automatically emitted at the end of execution.
 *
 * @example
 * ```typescript
 * import { createLogger, runWithWideEvent } from '@prismalens/logger/standalone';
 *
 * const logger = createLogger({ ... });
 *
 * await runWithWideEvent('job-123', async () => {
 *   logger.info('Processing job');
 *   // ... job processing
 * }, {
 *   context: {
 *     job_id: 'job-123',
 *     job_name: 'investigation',
 *   },
 * });
 * ```
 */
export async function runWithWideEvent<T>(
	jobId: string,
	fn: () => Promise<T>,
	initialContext?: Partial<WideEvent>,
): Promise<T> {
	const logger = Logger.getInstance();

	return runInRequestContext(
		async () => {
			try {
				const result = await fn();
				logger.emitWideEvent();
				return result;
			} catch (error) {
				enrichContext({
					error: {
						type: (error as Error).name || "Error",
						message: (error as Error).message,
						stack: (error as Error).stack,
					},
				});
				logger.emitWideEvent();
				throw error;
			}
		},
		{
			request_id: jobId,
			...initialContext,
		},
	) as Promise<T>;
}

/**
 * Run a synchronous function within a wide event context.
 */
export function runWithWideEventSync<T>(
	jobId: string,
	fn: () => T,
	initialContext?: Partial<WideEvent>,
): T {
	const logger = Logger.getInstance();

	return runInRequestContext(
		() => {
			try {
				const result = fn();
				logger.emitWideEvent();
				return result;
			} catch (error) {
				enrichContext({
					error: {
						type: (error as Error).name || "Error",
						message: (error as Error).message,
						stack: (error as Error).stack,
					},
				});
				logger.emitWideEvent();
				throw error;
			}
		},
		{
			request_id: jobId,
			...initialContext,
		},
	) as T;
}

// Re-export context utilities for manual enrichment
export { enrichContext, getRequestId, getTraceId };
export { runInRequestContext } from "../../core/context.js";
