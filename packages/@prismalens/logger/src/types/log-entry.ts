// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LogLevel, WideEvent } from "./wide-event.js";

/**
 * Simple log entry for traditional logging.
 * Gets embedded into wide events or used standalone.
 */
export interface LogEntry {
	level: LogLevel;
	message: string;
	context?: string;
	timestamp: string;
	args?: unknown[];
	error?: Error;
}

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
	/** Logger context name (e.g., class name) */
	context?: string;
	/** Default metadata to include in all log entries */
	defaultMeta?: Record<string, unknown>;
	/** Minimum log level to emit */
	minLevel?: LogLevel;
	/** Output format */
	format?: "text" | "json";
}

/**
 * Request scope data stored in AsyncLocalStorage.
 */
export interface RequestScope {
	/** Unique request ID */
	requestId: string;
	/** Distributed trace ID */
	traceId?: string;
	/** Span ID */
	spanId?: string;
	/** Request start timestamp */
	startTime: number;
	/** Accumulated wide event data */
	wideEvent: Partial<WideEvent>;
}
