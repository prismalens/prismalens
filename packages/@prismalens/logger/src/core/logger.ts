// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { getConfig } from "@prismalens/config";
import pino, { type Logger as PinoLogger } from "pino";
import type { LogEntry, LoggerOptions } from "../types/log-entry.js";
import type { LogLevel, ServiceInfo, WideEvent } from "../types/wide-event.js";
import { redactSensitiveData } from "../utils/redaction.js";
import { truncatePayload } from "../utils/truncation.js";
import {
	enrichContext,
	getCurrentWideEvent,
	getRequestScope,
} from "./context.js";
import { TailSampler } from "./sampler.js";

const _LOG_LEVELS: Record<LogLevel, number> = {
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
};

const PINO_LEVEL_MAP: Record<LogLevel, string> = {
	debug: "debug",
	info: "info",
	warn: "warn",
	error: "error",
};

/**
 * Main logger class implementing wide events logging with Pino.
 */
export class Logger {
	private readonly context: string;
	private readonly pino: PinoLogger;
	private readonly sampler: TailSampler;
	private readonly maxPayloadSize: number;
	private readonly includeStackTrace: boolean;

	private static instance: Logger | null = null;
	private static serviceInfo: ServiceInfo | null = null;

	constructor(options: LoggerOptions = {}) {
		const config = getConfig();

		this.context = options.context ?? "Application";
		this.maxPayloadSize = config.PRISMALENS_LOG_MAX_PAYLOAD_SIZE;
		this.includeStackTrace = config.PRISMALENS_LOG_INCLUDE_STACK_TRACE;

		// Initialize Pino logger
		const isPretty = config.PRISMALENS_LOG_FORMAT === "text";
		const pinoOptions: pino.LoggerOptions = {
			level: config.PRISMALENS_LOG_LEVEL,
			formatters: {
				level: (label) => ({ level: label }),
			},
			timestamp: pino.stdTimeFunctions.isoTime,
		};

		if (isPretty) {
			// Use pino-pretty for human-readable output in development
			this.pino = pino({
				...pinoOptions,
				transport: {
					target: "pino-pretty",
					options: {
						colorize: true,
						translateTime: "SYS:standard",
						ignore: "pid,hostname",
					},
				},
			});
		} else {
			this.pino = pino(pinoOptions);
		}

		// Initialize sampler
		this.sampler = new TailSampler(config);
	}

	/**
	 * Set service metadata (called once at startup).
	 */
	static setServiceInfo(info: ServiceInfo): void {
		Logger.serviceInfo = info;
	}

	/**
	 * Get service info.
	 */
	static getServiceInfo(): ServiceInfo | null {
		return Logger.serviceInfo;
	}

	/**
	 * Get singleton logger instance.
	 */
	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	/**
	 * Reset singleton instance (for testing).
	 */
	static resetInstance(): void {
		Logger.instance = null;
		Logger.serviceInfo = null;
	}

	/**
	 * Create a child logger with specific context.
	 */
	child(context: string): Logger {
		const childLogger = new Logger({ context });
		return childLogger;
	}

	/**
	 * Get the current context name.
	 */
	getContext(): string {
		return this.context;
	}

	// ===== Standard Log Methods =====

	debug(message: string, ...args: unknown[]): void {
		this.log("debug", message, args);
	}

	info(message: string, ...args: unknown[]): void {
		this.log("info", message, args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.log("warn", message, args);
	}

	error(message: string, error?: Error | unknown, ...args: unknown[]): void {
		const errorObj = error instanceof Error ? error : undefined;
		const extraArgs =
			error instanceof Error
				? args
				: [error, ...args].filter((a) => a !== undefined);
		this.log("error", message, extraArgs, errorObj);
	}

	/**
	 * Emit a complete wide event (typically at end of request).
	 * Applies tail sampling to decide if the event should be retained.
	 */
	emitWideEvent(additionalData?: Partial<WideEvent>): void {
		const scope = getRequestScope();
		let finalEvent = getCurrentWideEvent() ?? {};

		if (additionalData) {
			finalEvent = { ...finalEvent, ...additionalData };
		}

		// Add service info
		if (Logger.serviceInfo) {
			finalEvent.service = Logger.serviceInfo;
		}

		// Calculate final duration
		if (scope) {
			finalEvent.duration_ms = Date.now() - scope.startTime;
		}

		// Apply tail sampling
		const decision = this.sampler.shouldSample(finalEvent);
		finalEvent.sampling = {
			decision: decision.shouldRetain ? "retained" : "dropped",
			reason: decision.reason,
			rate: this.sampler.getOptions().sampleRate,
		};

		if (!decision.shouldRetain) {
			return; // Drop the event
		}

		// Apply redaction and truncation
		const safeEvent = redactSensitiveData(finalEvent);
		const truncatedEvent = truncatePayload(safeEvent, this.maxPayloadSize);

		// Emit as a structured log entry
		this.pino.info({ ...truncatedEvent, _type: "wide_event" }, "wide_event");
	}

	/**
	 * Internal log method.
	 */
	private log(
		level: LogLevel,
		message: string,
		args: unknown[],
		error?: Error,
	): void {
		const _entry: LogEntry = {
			level,
			message,
			context: this.context,
			timestamp: new Date().toISOString(),
			args: args.length > 0 ? args : undefined,
			error,
		};

		// Enrich wide event context if in request scope
		const enrichment: Partial<WideEvent> = {
			log: {
				level,
				message,
				context: this.context,
				args: args.length > 0 ? args : undefined,
			},
		};

		if (error) {
			enrichment.error = {
				type: error.name,
				message: error.message,
				stack: this.includeStackTrace ? error.stack : undefined,
			};
		}

		enrichContext(enrichment);

		// Build log object
		const logObj: Record<string, unknown> = {
			context: this.context,
		};

		if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
			Object.assign(logObj, args[0]);
		} else if (args.length > 0) {
			logObj.data = args;
		}

		if (error) {
			logObj.err = {
				type: error.name,
				message: error.message,
				stack: this.includeStackTrace ? error.stack : undefined,
			};
		}

		// Use Pino to emit the log
		const pinoLevel = PINO_LEVEL_MAP[level];
		(
			this.pino[pinoLevel as keyof PinoLogger] as (
				obj: unknown,
				msg: string,
			) => void
		)(logObj, message);
	}

	/**
	 * Enrich the current request context with additional data.
	 */
	enrich(data: Record<string, unknown>): void {
		enrichContext({ context: data });
	}
}

// ===== Convenience exports for standalone usage =====

/**
 * Get the singleton logger instance.
 */
export function getLogger(): Logger {
	return Logger.getInstance();
}

/**
 * Create a child logger with a specific context.
 */
export function createChildLogger(context: string): Logger {
	return Logger.getInstance().child(context);
}
