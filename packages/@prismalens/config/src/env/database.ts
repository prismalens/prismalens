// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * SQLite database configuration.
 * Database file path is hardcoded to .prismalens/prismalens.db
 * Configuration focuses on better-sqlite3 library options.
 */
export const sqliteConfigSchema = z.object({
	PRISMALENS_DB_SQLITE_READONLY: z
		.enum(["true", "false"])
		.transform((val) => val === "true")
		.prefault("false")
		.describe("Open SQLite database connection in readonly mode"),
	PRISMALENS_DB_SQLITE_FILE_MUST_EXIST: z
		.enum(["true", "false"])
		.transform((val) => val === "true")
		.prefault("false")
		.describe("Throw error if SQLite database file does not exist"),
	PRISMALENS_DB_SQLITE_TIMEOUT: z.coerce
		.number()
		.default(5000)
		.describe("Milliseconds to wait when executing queries on locked database"),
});

export type SqliteConfig = z.infer<typeof sqliteConfigSchema>;

/**
 * Database configuration schema (SQLite only — #597).
 * Includes app data directory configuration for proper data storage.
 */
export const databaseSchema = z.object({
	...sqliteConfigSchema.shape,
});

export type DatabaseConfig = z.infer<typeof databaseSchema>;
