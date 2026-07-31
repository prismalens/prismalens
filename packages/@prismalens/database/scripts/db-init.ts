#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
/**
 * Smart database initialization script.
 * Detects database state and runs appropriate Prisma commands.
 * Supports separate migration folders for SQLite and PostgreSQL.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is packages/@prismalens/database/scripts. prisma.config.ts,
// the schema, and the migrations all live one level up, in the database
// package itself — NOT in packages/api. The previous version of this file
// resolved a `packages/api` path here and passed it to execSync as `cwd`,
// which does not exist, surfacing as `spawnSync /bin/sh ENOENT` (Node can't
// chdir into a missing directory). It also pointed migrationsExist() at
// invented `prisma/migrations-{sqlite,pg}` folders that were never the real
// location — the actual migrations live alongside the schema, at
// `prisma/{sqlite,pg}/schema`, per prisma.config.ts's `migrations.path`.
const DATABASE_PATH = resolve(__dirname, "..");

type DbType = "sqlite" | "postgresql";

function getDbType(): DbType {
	return (process.env.PRISMALENS_DB_TYPE || "sqlite") as DbType;
}

function getMigrationsPath(dbType: DbType): string {
	const folder = dbType === "postgresql" ? "pg/schema" : "sqlite/schema";
	return resolve(DATABASE_PATH, `prisma/${folder}`);
}

function migrationsExist(dbType: DbType): boolean {
	const migrationsPath = getMigrationsPath(dbType);
	if (!existsSync(migrationsPath)) return false;
	try {
		const entries = readdirSync(migrationsPath, { withFileTypes: true });
		// Check for actual migration folders (not just migration_lock.toml)
		return entries.some((e) => e.isDirectory() && !e.name.startsWith("."));
	} catch {
		return false;
	}
}

function sqliteDbExists(): boolean {
	// Matches @prismalens/config's buildSqliteUrl()/getAppDataDir(): the db
	// file lives in the app data dir (~/.prismalens by default, or
	// PRISMALENS_WORKSPACE_DIR). Duplicated inline rather than imported from
	// @prismalens/config to keep this script's dependency surface minimal —
	// that package's src currently throws at runtime (zod's `.prefault()` is
	// not available on the installed zod 3.25.76) when resolved through tsx's
	// workspace source-path aliasing; see repo db:init friction notes.
	const appDataDir =
		process.env.PRISMALENS_WORKSPACE_DIR || join(homedir(), ".prismalens");
	return existsSync(join(appDataDir, "prismalens.db"));
}

async function main() {
	console.log("🔍 Checking database state...");

	const dbType = getDbType();
	const migrationsFolder = dbType === "postgresql" ? "pg/schema" : "sqlite/schema";
	const hasMigrations = migrationsExist(dbType);
	const dbExists = dbType === "sqlite" ? sqliteDbExists() : true; // PostgreSQL connectivity deferred to Prisma

	console.log(`   Database type: ${dbType}`);
	console.log(`   Migrations path: prisma/${migrationsFolder}`);
	console.log(`   Migrations exist: ${hasMigrations}`);
	if (dbType === "sqlite") {
		console.log(`   Database exists: ${dbExists}`);
	}

	if (!hasMigrations) {
		// Fresh install - create initial migration
		console.log("📦 Creating initial migration...");
		execSync("pnpm exec prisma migrate dev --name init --config prisma.config.ts", {
			cwd: DATABASE_PATH,
			stdio: "inherit",
			env: { ...process.env },
		});
	} else if (!dbExists) {
		// Migrations exist but DB is missing - apply them
		console.log("🔄 Applying migrations to new database...");
		execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
			cwd: DATABASE_PATH,
			stdio: "inherit",
			env: { ...process.env },
		});
	} else {
		// Check for pending migrations using migrate status
		console.log("✅ Database ready (checking for pending migrations...)");
		try {
			const result = execSync(
				"pnpm exec prisma migrate status --config prisma.config.ts",
				{
					cwd: DATABASE_PATH,
					stdio: "pipe",
					env: { ...process.env },
				},
			);
			const output = result.toString();

			// If output mentions pending migrations, apply them
			if (
				output.includes("Following migration") ||
				output.includes("have not yet been applied")
			) {
				console.log("🔄 Applying pending migrations...");
				execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
					cwd: DATABASE_PATH,
					stdio: "inherit",
					env: { ...process.env },
				});
			} else {
				console.log("✅ All migrations are up to date");
			}
		} catch (_error) {
			// migrate status returns non-zero if there are pending migrations or issues
			console.log("🔄 Applying pending migrations...");
			execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
				cwd: DATABASE_PATH,
				stdio: "inherit",
				env: { ...process.env },
			});
		}
	}

	console.log("✅ Database initialization complete");
}

main().catch((err) => {
	console.error("❌ Database initialization failed:", err.message);
	process.exit(1);
});
