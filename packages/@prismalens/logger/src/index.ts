/**
 * @prismalens/logger
 *
 * Wide events logging with tail sampling for PrismaLens.
 *
 * @example Basic usage
 * ```typescript
 * import { Logger, enrichContext } from '@prismalens/logger';
 *
 * const logger = new Logger({ context: 'MyService' });
 * logger.info('Hello world');
 *
 * // Enrich the current request context
 * enrichContext({ context: { user_id: '123' } });
 * ```
 *
 * @example NestJS integration
 * ```typescript
 * import { LoggerModule, LoggerService } from '@prismalens/logger/nestjs';
 *
 * // In app.module.ts
 * @Module({
 *   imports: [
 *     LoggerModule.forRoot({
 *       service: { name: 'my-api', version: '1.0.0', environment: 'development' },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // In a service
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly logger: LoggerService) {
 *     this.logger.setContext(MyService.name);
 *   }
 * }
 * ```
 *
 * @example Standalone usage (Worker, Agents)
 * ```typescript
 * import { createLogger, runWithWideEvent } from '@prismalens/logger/standalone';
 *
 * const logger = createLogger({
 *   service: { name: 'my-worker', version: '1.0.0', environment: 'development' },
 * });
 *
 * await runWithWideEvent('job-123', async () => {
 *   logger.info('Processing job');
 * });
 * ```
 */

// Core exports
export * from "./types/index.js";
export * from "./core/index.js";
export * from "./utils/index.js";

// Convenience re-exports
export { Logger, getLogger, createChildLogger } from "./core/logger.js";
export {
	enrichContext,
	getRequestId,
	getTraceId,
	getSpanId,
	hasRequestContext,
	runInRequestContext,
	getCurrentWideEvent,
} from "./core/context.js";
export { TailSampler } from "./core/sampler.js";
