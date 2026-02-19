/**
 * Utility functions for building database connection URLs from config.
 * Used to construct connection strings for different database providers.
 */

import { join } from "path";
import type { DatabaseConfig } from "../env/database.js";
import { getAppDataDir } from "./app-data.js";

/**
 * Build a PostgreSQL connection URL from configuration.
 *
 * @param config - Database configuration object
 * @returns PostgreSQL connection URL
 */
function buildPostgresUrl(config: DatabaseConfig): string {
	const user = encodeURIComponent(
		config.PRISMALENS_DB_POSTGRES_USER || "postgres",
	);
	const password = config.PRISMALENS_DB_POSTGRES_PASSWORD
		? encodeURIComponent(config.PRISMALENS_DB_POSTGRES_PASSWORD)
		: "";
	const host = config.PRISMALENS_DB_POSTGRES_HOST || "localhost";
	const port = config.PRISMALENS_DB_POSTGRES_PORT || 5432;
	const database = config.PRISMALENS_DB_POSTGRES_DATABASE || "prismalens";
	const schema = config.PRISMALENS_DB_POSTGRES_SCHEMA || "public";

	const credentials = password ? `${user}:${password}` : user;
	return `postgresql://${credentials}@${host}:${port}/${database}?schema=${schema}`;
}

/**
 * Build a SQLite connection URL from configuration.
 * Database path is stored in the app data directory (~/.prismalens by default).
 * Can be customized via PRISMALENS_USER_FOLDER environment variable.
 *
 * @param config - Database configuration object
 * @returns SQLite file path (prefixed with file:)
 */
function buildSqliteUrl(config: DatabaseConfig): string {
	const appDataDir = getAppDataDir();
	const dbPath = join(appDataDir, "prismalens.db");
	return `file:${dbPath}`;
}

/**
 * Build the appropriate database connection URL based on configuration.
 *
 * @param config - Database configuration object
 * @returns Database connection URL
 * @throws Error if database type is not supported
 */
export function buildDatabaseUrl(config: DatabaseConfig): string {
	switch (config.PRISMALENS_DB_TYPE) {
		case "postgresql":
			return buildPostgresUrl(config);
		case "sqlite":
			return buildSqliteUrl(config);
		default:
			throw new Error(
				`Unsupported database type: ${config.PRISMALENS_DB_TYPE as string}. Supported types: sqlite, postgresql`,
			);
	}
}
