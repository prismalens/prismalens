// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import consola from "consola";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineCommand({
	meta: {
		name: "up",
		description:
			"Boot the packed single-origin PrismaLens app (API + SPA on one port)",
	},
	async run() {
		consola.info("Starting PrismaLens single-origin application...");

		// Ensure static SPA directory is known to Nest AppModule
		// Compiled location is dist/src/cli/up.js -> dist/public is ../../public
		const staticDir =
			process.env.PRISMALENS_STATIC_DIR ||
			path.resolve(__dirname, "../../public");
		process.env.PRISMALENS_STATIC_DIR = staticDir;

		// Ensure PRISMALENS_WORKSPACE_DIR is set to isolate app database
		const workspaceDir =
			process.env.PRISMALENS_WORKSPACE_DIR ||
			path.resolve(process.cwd(), ".prismalens-workspace");
		process.env.PRISMALENS_WORKSPACE_DIR = workspaceDir;
		fs.mkdirSync(workspaceDir, { recursive: true });

		// Auto-initialize SQLite database if missing or empty
		const dbPath = path.join(workspaceDir, "prismalens.db");
		if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
			consola.info("Initializing fresh SQLite database at:", dbPath);
			const migrationPaths = [
				path.resolve(
					__dirname,
					"../../prisma/schema/20260803122809_init/migration.sql",
				),
				path.resolve(
					__dirname,
					"../../node_modules/@prismalens/database/prisma/sqlite/schema/20260803122809_init/migration.sql",
				),
			];
			const sqlPath = migrationPaths.find((p) => fs.existsSync(p));
			if (sqlPath) {
				const Database = (await import("better-sqlite3")).default;
				const db = new Database(dbPath);
				const sql = fs.readFileSync(sqlPath, "utf8");
				db.exec(sql);
				db.close();
				consola.info("Database schema initialized successfully.");
			} else {
				consola.warn("Migration SQL file not found for database auto-init.");
			}
		}

		// Resolve Nest main entry point inside packed artifact
		const mainPath = fs.existsSync(
			path.resolve(__dirname, "../../api/src/main.js"),
		)
			? path.resolve(__dirname, "../../api/src/main.js")
			: path.resolve(__dirname, "../../api/main.js");
		try {
			await import(mainPath);
		} catch (err) {
			consola.error("Failed to boot NestJS API main module from:", mainPath);
			throw err;
		}
	},
});
