/**
 * Prisma Configuration for PostgreSQL
 *
 * This config file tells Prisma where to find the schema files for PostgreSQL.
 * The multi-file schema feature allows splitting the schema across multiple files.
 *
 * Usage:
 *   prisma generate --config prisma.pg.config.ts
 *   prisma migrate dev --config prisma.pg.config.ts
 */

import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
	schema: path.join("prisma", "pg", "schema"),
	migrations: {
		path: path.join("prisma", "pg", "migrations"),
	},
	datasource: {
		url: env("DATABASE_URL"),
	},
});
