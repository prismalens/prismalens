#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Local database initialisation for contributors (`pnpm db:init`).
 *
 * For SQLite this deliberately runs the SAME shipped runner an end user's
 * `pl up` runs (`@prismalens/database/migrator`) rather than shelling out to
 * `prisma migrate deploy`. Two reasons:
 *
 * 1. A packed install has neither `pnpm` nor the `prisma` CLI — that path could
 *    never have worked outside this repo.
 * 2. Migrate-on-boot had never run in anger, because a second migration had
 *    never existed. Routing the daily dev loop through it means the runner is
 *    exercised on every contributor machine, not only on upgrade day.
 *
 * PostgreSQL (the server placement) still uses the Prisma CLI: that deploy has
 * a CLI available and is outside the shipped runner's scope.
 *
 * Authoring a NEW migration is `pnpm db:migrate` (`prisma migrate dev`). This
 * script never creates one — migration history is append-only from R1 onward
 * (issue #335), and a script that can mint an `init` is a script that can
 * silently replace a user's history.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { MigrationError, runMigrations } from "../src/migrator/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is packages/@prismalens/database/scripts. prisma.config.ts, the
// schema, and the migrations all live one level up, in the database package
// itself — NOT in packages/api.
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
		// Actual migration folders, not just migration_lock.toml.
		return entries.some((e) => e.isDirectory() && !e.name.startsWith("."));
	} catch {
		return false;
	}
}

function sqliteDbPath(): string {
	// Matches @prismalens/config's buildSqliteUrl()/getAppDataDir(): the db file
	// lives in the app data dir (~/.prismalens by default, or
	// PRISMALENS_WORKSPACE_DIR).
	const appDataDir =
		process.env.PRISMALENS_WORKSPACE_DIR || join(homedir(), ".prismalens");
	return join(appDataDir, "prismalens.db");
}

function seed(): void {
	const seedDemo =
		process.env.PRISMALENS_SEED_DEMO === "1" ||
		process.env.NODE_ENV === "development";
	if (!seedDemo) {
		console.log(
			"⏭️  Skipping demo data (set PRISMALENS_SEED_DEMO=1 or NODE_ENV=development to provision it)",
		);
		return;
	}
	console.log("🌱 Provisioning demo data for new database...");
	execSync("pnpm exec prisma db seed --config prisma.config.ts", {
		cwd: DATABASE_PATH,
		stdio: "inherit",
		env: { ...process.env },
	});
}

async function main() {
	console.log("🔍 Checking database state...");

	const dbType = getDbType();
	const migrationsFolder =
		dbType === "postgresql" ? "pg/schema" : "sqlite/schema";

	console.log(`   Database type: ${dbType}`);
	console.log(`   Migrations path: prisma/${migrationsFolder}`);

	if (!migrationsExist(dbType)) {
		throw new Error(
			`No migrations found in prisma/${migrationsFolder}. Author one with ` +
				"`pnpm db:migrate` — this script never creates an initial migration, " +
				"because migration history is append-only from R1 onward (#335).",
		);
	}

	if (dbType === "postgresql") {
		// Server placement: the Prisma CLI is available here by definition.
		console.log("🔄 Applying migrations with the Prisma CLI...");
		execSync("pnpm exec prisma migrate deploy --config prisma.config.ts", {
			cwd: DATABASE_PATH,
			stdio: "inherit",
			env: { ...process.env },
		});
		console.log("✅ Database initialization complete");
		return;
	}

	const dbPath = sqliteDbPath();
	const wasFresh = !existsSync(dbPath);
	console.log(`   Database file: ${dbPath}`);
	console.log(`   Database exists: ${!wasFresh}`);

	const result = await runMigrations({
		databaseFile: dbPath,
		log: (message) => console.log(`   ${message}`),
	});

	if (result.status === "applied") {
		console.log(`🔄 Applied: ${result.applied.join(", ")}`);
	} else {
		console.log("✅ All migrations are up to date");
	}

	if (wasFresh) seed();

	console.log("✅ Database initialization complete");
}

main().catch((err) => {
	if (err instanceof MigrationError) {
		console.error(`❌ Database initialization failed [${err.code}]`);
		console.error(err.message);
	} else {
		console.error("❌ Database initialization failed:", err.message);
	}
	process.exit(1);
});
