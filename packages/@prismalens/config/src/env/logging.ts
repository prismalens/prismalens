// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * Log level configuration.
 * Hierarchy: debug < info < warn < error
 */
const logLevelSchema = z
	.enum(["debug", "info", "warn", "error"])
	.default("info");
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * Log format configuration.
 * - text: Human-readable with colors (dev mode)
 * - json: Structured JSON (production, log aggregation)
 */
const logFormatSchema = z.enum(["text", "json"]).default("json");
export type LogFormat = z.infer<typeof logFormatSchema>;

/**
 * Logging configuration schema following n8n patterns.
 * Supports wide events logging with tail sampling.
 *
 * @see https://loggingsucks.com/ - Wide events principles
 * @see https://docs.n8n.io/hosting/configuration/environment-variables/logs/ - n8n patterns
 */
export const loggingSchema = z.object({
	// ===== Core Logging Settings =====
	PRISMALENS_LOG_LEVEL: logLevelSchema.describe(
		"Minimum log level to emit (debug, info, warn, error). Default: info",
	),
	PRISMALENS_LOG_OUTPUT: z
		.string()
		.default("console")
		.describe(
			"Log output targets, comma-separated (console, file). Default: console",
		),
	PRISMALENS_LOG_FORMAT: logFormatSchema.describe(
		"Log format: text for human-readable dev output, json for structured production logging. Default: json",
	),

	// ===== File Output Settings =====
	PRISMALENS_LOG_FILE_LOCATION: z
		.string()
		.optional()
		.describe(
			"Directory path for log files. Defaults to PRISMALENS_PATH/logs (~/.prismalens/logs)",
		),
	PRISMALENS_LOG_FILE_COUNT_MAX: z.coerce
		.number()
		.min(1)
		.max(1000)
		.default(100)
		.describe("Maximum number of rotated log files to retain. Default: 100"),
	PRISMALENS_LOG_FILE_SIZE_MAX: z.coerce
		.number()
		.min(1)
		.max(1024)
		.default(16)
		.describe("Maximum size per log file in MB before rotation. Default: 16"),
	PRISMALENS_LOG_FILE_NAME: z
		.string()
		.default("prismalens.log")
		.describe("Base filename for log files. Default: prismalens.log"),

	// ===== Database Query Logging (Prisma) =====
	PRISMALENS_DB_LOGGING_ENABLED: z
		.enum(["true", "false"])
		.transform((val) => val === "true")
		.default("false")
		.describe("Enable database query logging for debugging. Default: false"),
	PRISMALENS_DB_LOGGING_MAX_EXECUTION_TIME: z.coerce
		.number()
		.min(0)
		.default(1000)
		.describe(
			"Threshold in milliseconds for slow query warnings. Queries exceeding this are always logged. Default: 1000",
		),

	// ===== Tail Sampling Configuration =====
	PRISMALENS_LOG_SAMPLING_ENABLED: z
		.enum(["true", "false"])
		.transform((val) => val === "true")
		.default("true")
		.describe(
			"Enable tail sampling for wide events. When enabled, only errors, slow requests, and sampled normal traffic are retained. Default: true",
		),
	PRISMALENS_LOG_SAMPLING_RATE: z.coerce
		.number()
		.min(0)
		.max(100)
		.default(5)
		.describe(
			"Percentage of normal (non-error, non-slow) traffic to sample (0-100). Errors and slow requests are always retained. Default: 5",
		),
	PRISMALENS_LOG_SAMPLING_LATENCY_THRESHOLD: z.coerce
		.number()
		.min(0)
		.default(5000)
		.describe(
			"Latency threshold in milliseconds. Requests exceeding this duration are always retained regardless of sampling. Default: 5000",
		),

	// ===== Wide Event Settings =====
	PRISMALENS_LOG_INCLUDE_STACK_TRACE: z
		.enum(["true", "false"])
		.transform((val) => val === "true")
		.default("true")
		.describe(
			"Include stack traces in error logs. Disable for reduced log size in production. Default: true",
		),
	PRISMALENS_LOG_MAX_PAYLOAD_SIZE: z.coerce
		.number()
		.min(1024)
		.default(65536)
		.describe(
			"Maximum size in bytes for logged payloads (request/response bodies). Larger payloads are truncated. Default: 65536 (64KB)",
		),
});

export type LoggingConfig = z.infer<typeof loggingSchema>;
