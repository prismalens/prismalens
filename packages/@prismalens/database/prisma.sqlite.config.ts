/**
 * Prisma Configuration for SQLite
 *
 * This config file tells Prisma where to find the schema files for SQLite.
 * The multi-file schema feature allows splitting the schema across multiple files.
 *
 * Usage:
 *   prisma generate --config prisma.sqlite.config.ts
 *   prisma migrate dev --config prisma.sqlite.config.ts
 */

import "dotenv/config";
import { homedir } from "node:os";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Get database path from env or use default
const userFolder = process.env.PRISMALENS_USER_FOLDER ?? homedir();
const dbPath = path.join(userFolder, ".prismalens", "prismalens.db");

export default defineConfig({
	schema: path.join("prisma", "sqlite", "schema"),
	migrations: {
		path: path.join("prisma", "sqlite", "migrations"),
	},
	datasource: {
		url: `file:${dbPath}`,
	},
});
