#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Local database initialisation (`pnpm db:init`). Runs the same shipped
// SQLite runner an end user's `pl up` runs — never `prisma migrate deploy`,
// and never mints an `init`: migration history is append-only (#335, #597).

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
const MIGRATIONS_PATH = resolve(DATABASE_PATH, "prisma/sqlite/schema");

function migrationsExist(): boolean {
	if (!existsSync(MIGRATIONS_PATH)) return false;
	try {
		const entries = readdirSync(MIGRATIONS_PATH, { withFileTypes: true });
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
	console.log("   Migrations path: prisma/sqlite/schema");

	if (!migrationsExist()) {
		throw new Error(
			"No migrations found in prisma/sqlite/schema. Author one with " +
				"`pnpm db:migrate` — this script never creates an initial migration, " +
				"because migration history is append-only from R1 onward (#335).",
		);
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
