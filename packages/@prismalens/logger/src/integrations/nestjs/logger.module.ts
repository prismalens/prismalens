import { Global, Module, type DynamicModule, type Provider } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { LoggerService } from "./logger.service.js";
import { WideEventInterceptor } from "./request.interceptor.js";
import { Logger } from "../../core/logger.js";
import type { ServiceInfo } from "../../types/wide-event.js";

/**
 * Options for configuring the LoggerModule.
 */
export interface LoggerModuleOptions {
	/** Service information to include in all log entries */
	service: ServiceInfo;
	/** Enable wide event interceptor (default: true) */
	enableWideEvents?: boolean;
	/** Enable global interceptor registration (default: true) */
	global?: boolean;
}

/**
 * Injection token for logger options.
 */
export const LOGGER_OPTIONS = Symbol("LOGGER_OPTIONS");

/**
 * NestJS module for the PrismaLens logger.
 *
 * @example
 * ```typescript
 * import { LoggerModule } from '@prismalens/logger/nestjs';
 *
 * @Module({
 *   imports: [
 *     LoggerModule.forRoot({
 *       service: {
 *         name: 'prismalens-api',
 *         version: '1.0.0',
 *         environment: process.env.NODE_ENV ?? 'development',
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class LoggerModule {
	/**
	 * Configure the logger module with options.
	 */
	static forRoot(options: LoggerModuleOptions): DynamicModule {
		// Set service info globally for all loggers
		Logger.setServiceInfo(options.service);

		const providers: Provider[] = [
			LoggerService,
			{
				provide: LOGGER_OPTIONS,
				useValue: options,
			},
		];

		// Add wide event interceptor if enabled (default: true)
		if (options.enableWideEvents !== false) {
			providers.push({
				provide: APP_INTERCEPTOR,
				useClass: WideEventInterceptor,
			});
		}

		return {
			module: LoggerModule,
			global: options.global !== false,
			providers,
			exports: [LoggerService, LOGGER_OPTIONS],
		};
	}

	/**
	 * Configure the logger module asynchronously.
	 */
	static forRootAsync(options: {
		useFactory: (
			...args: unknown[]
		) => LoggerModuleOptions | Promise<LoggerModuleOptions>;
		inject?: Array<unknown>;
	}): DynamicModule {
		const providers: Provider[] = [
			LoggerService,
			{
				provide: LOGGER_OPTIONS,
				useFactory: async (...args: unknown[]) => {
					const moduleOptions = await options.useFactory(...args);
					Logger.setServiceInfo(moduleOptions.service);
					return moduleOptions;
				},
				inject: (options.inject || []) as Array<string | symbol>,
			},
		];

		// Always add the interceptor in async mode (will check options at runtime)
		providers.push({
			provide: APP_INTERCEPTOR,
			useClass: WideEventInterceptor,
		});

		return {
			module: LoggerModule,
			global: true,
			providers,
			exports: [LoggerService, LOGGER_OPTIONS],
		};
	}
}
