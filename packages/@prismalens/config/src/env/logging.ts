// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join } from "node:path";
import { z } from "zod";
import { getAppDataDir } from "../utils/app-data.js";

/**
 * Log level configuration.
 * Hierarchy: debug < info < warn < error
 */
const logLevelSchema = z
	.enum(["debug", "info", "warn", "error"])
	.default("info");
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * Console output mode:
 * - quiet: only warn and error records reach the terminal
 * - verbose: every record at or above PRISMALENS_LOG_LEVEL is printed to the terminal
 */
const logConsoleSchema = z.enum(["quiet", "verbose"]).default("quiet");
export type LogConsole = z.infer<typeof logConsoleSchema>;

/**
 * Logging configuration schema.
 * Defines log rotation, console filtering, and database logging settings.
 */
export const loggingSchema = z.object({
	// ===== Core Logging Settings =====
	PRISMALENS_LOG_LEVEL: logLevelSchema.describe(
		"Minimum log level to emit to the log file (debug, info, warn, error). Default: info",
	),
	PRISMALENS_LOG_CONSOLE: logConsoleSchema.describe(
		"Console log output mode: quiet (warn/error only) or verbose (stream all records). Default: quiet",
	),

	// ===== File Output Settings =====
	PRISMALENS_LOG_FILE_LOCATION: z
		.string()
		.default(() => join(getAppDataDir(), "logs"))
		.describe(
			"Directory path for log files. Defaults to PRISMALENS_WORKSPACE_DIR/logs (~/.prismalens/logs)",
		),
	PRISMALENS_LOG_FILE_COUNT_MAX: z.coerce
		.number()
		.min(1)
		.max(1000)
		.default(5)
		.describe("Maximum number of rotated log files to retain. Default: 5"),
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
		.prefault("false")
		.describe("Enable database query logging for debugging. Default: false"),
	PRISMALENS_DB_LOGGING_MAX_EXECUTION_TIME: z.coerce
		.number()
		.min(0)
		.default(1000)
		.describe(
			"Threshold in milliseconds for slow query warnings. Queries exceeding this are always logged. Default: 1000",
		),
});

export type LoggingConfig = z.infer<typeof loggingSchema>;
