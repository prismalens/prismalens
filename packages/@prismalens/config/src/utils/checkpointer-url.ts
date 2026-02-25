/**
 * Build connection strings for LangGraph checkpoint persistence.
 *
 * Separated from database-url.ts because LangGraph's PostgresSaver
 * does NOT use Prisma's `?schema=` query param (it manages schema
 * via its own `{ schema }` option), and SQLite uses a separate file
 * to avoid write contention with Prisma's prismalens.db.
 */

import { join } from "node:path";
import type { DatabaseConfig } from "../env/database.js";
import { getAppDataDir } from "./app-data.js";

/**
 * Build a checkpointer connection URL from database config.
 *
 * - PostgreSQL: `postgresql://user:pass@host:port/db` (no ?schema= param)
 * - SQLite: file path `~/.prismalens/checkpoints.db`
 */
export function buildCheckpointerUrl(config: DatabaseConfig): string {
	if (config.PRISMALENS_DB_TYPE === "postgresql") {
		const user = encodeURIComponent(config.PRISMALENS_DB_POSTGRES_USER || "postgres");
		const password = config.PRISMALENS_DB_POSTGRES_PASSWORD
			? encodeURIComponent(config.PRISMALENS_DB_POSTGRES_PASSWORD)
			: "";
		const host = config.PRISMALENS_DB_POSTGRES_HOST || "localhost";
		const port = config.PRISMALENS_DB_POSTGRES_PORT || 5432;
		const database = config.PRISMALENS_DB_POSTGRES_DATABASE || "prismalens";

		const credentials = password ? `${user}:${password}` : user;
		return `postgresql://${credentials}@${host}:${port}/${database}`;
	}

	// SQLite: separate file from Prisma's prismalens.db
	return join(getAppDataDir(), "checkpoints.db");
}

/**
 * Get the PostgreSQL schema name for checkpoint tables.
 * LangGraph's PostgresSaver accepts this as a separate option, not as a URL param.
 */
export function getCheckpointerSchema(config: DatabaseConfig): string {
	return config.PRISMALENS_DB_POSTGRES_SCHEMA || "public";
}
