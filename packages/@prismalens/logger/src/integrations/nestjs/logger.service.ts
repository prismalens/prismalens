import {
	Injectable,
	type LoggerService as NestLoggerService,
	Scope,
} from "@nestjs/common";
import { enrichContext, getRequestId } from "../../core/context.js";
import { Logger } from "../../core/logger.js";

/**
 * NestJS LoggerService implementation that integrates with wide events.
 * Can be used as a drop-in replacement for NestJS Logger.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly logger: LoggerService) {
 *     this.logger.setContext(MyService.name);
 *   }
 *
 *   doSomething() {
 *     this.logger.log('Doing something');
 *     this.logger.enrich({ operation: 'doSomething' });
 *   }
 * }
 * ```
 */
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
	private logger: Logger;
	private context?: string;

	constructor() {
		this.logger = new Logger();
	}

	/**
	 * Set the logger context (typically the class name).
	 */
	setContext(context: string): this {
		this.context = context;
		this.logger = this.logger.child(context);
		return this;
	}

	/**
	 * Get the current context.
	 */
	getContext(): string | undefined {
		return this.context;
	}

	// ===== NestJS LoggerService Interface =====

	log(message: unknown, ...optionalParams: unknown[]): void {
		const ctx = this.extractContext(optionalParams);
		const logger = ctx ? this.logger.child(ctx) : this.logger;
		logger.info(
			this.formatMessage(message),
			...this.extractArgs(optionalParams),
		);
	}

	error(message: unknown, ...optionalParams: unknown[]): void {
		const ctx = this.extractContext(optionalParams);
		const stack = optionalParams.find(
			(p) => typeof p === "string" && p.includes("\n"),
		) as string | undefined;
		const logger = ctx ? this.logger.child(ctx) : this.logger;

		// Create synthetic error if stack provided
		if (stack) {
			const syntheticError = new Error(this.formatMessage(message));
			syntheticError.stack = stack;
			logger.error(this.formatMessage(message), syntheticError);
		} else {
			logger.error(
				this.formatMessage(message),
				...this.extractArgs(optionalParams),
			);
		}
	}

	warn(message: unknown, ...optionalParams: unknown[]): void {
		const ctx = this.extractContext(optionalParams);
		const logger = ctx ? this.logger.child(ctx) : this.logger;
		logger.warn(
			this.formatMessage(message),
			...this.extractArgs(optionalParams),
		);
	}

	debug?(message: unknown, ...optionalParams: unknown[]): void {
		const ctx = this.extractContext(optionalParams);
		const logger = ctx ? this.logger.child(ctx) : this.logger;
		logger.debug(
			this.formatMessage(message),
			...this.extractArgs(optionalParams),
		);
	}

	verbose?(message: unknown, ...optionalParams: unknown[]): void {
		// Map verbose to debug
		this.debug?.(message, ...optionalParams);
	}

	fatal?(message: unknown, ...optionalParams: unknown[]): void {
		// Map fatal to error
		this.error(message, ...optionalParams);
	}

	// ===== Wide Event Extensions =====

	/**
	 * Enrich the current wide event with additional context.
	 * Use this to add business context throughout request processing.
	 */
	enrich(data: Record<string, unknown>): void {
		enrichContext({ context: data });
	}

	/**
	 * Get current request ID for correlation.
	 */
	getRequestId(): string | undefined {
		return getRequestId();
	}

	/**
	 * Emit a wide event manually.
	 * Usually called automatically by the WideEventInterceptor.
	 */
	emitWideEvent(): void {
		this.logger.emitWideEvent();
	}

	// ===== Helper Methods =====

	private formatMessage(message: unknown): string {
		if (typeof message === "string") {
			return message;
		}
		if (message instanceof Error) {
			return message.message;
		}
		return JSON.stringify(message);
	}

	private extractContext(params: unknown[]): string | undefined {
		// Last string parameter without newlines is the context
		const last = params[params.length - 1];
		if (typeof last === "string" && !last.includes("\n")) {
			return last;
		}
		return this.context;
	}

	private extractArgs(params: unknown[]): unknown[] {
		// Remove context string from end if present
		const last = params[params.length - 1];
		if (typeof last === "string" && !last.includes("\n")) {
			return params.slice(0, -1).filter((p) => p !== undefined);
		}
		return params.filter((p) => p !== undefined);
	}
}
