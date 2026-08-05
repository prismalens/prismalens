// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `@prismalens/database/migrator` — the shipped SQLite migration runner.
 *
 * Deliberately a separate entry point from the package root: importing it does
 * NOT construct a `PrismaClient`, so an app can migrate its database before any
 * client touches it, and `pl up` can pull in the runner without the whole ORM.
 */

export {
	MIGRATIONS_DIR_ENV,
	type MigrationFlavour,
	migrationDirCandidates,
	readShippedMigrations,
	resolveMigrationsDir,
	type ShippedMigration,
} from "./migration-source.js";
export {
	CREATE_MIGRATIONS_TABLE_SQL,
	defaultDatabaseFile,
	MigrationError,
	type MigrationErrorCode,
	type MigrationRunResult,
	type RunMigrationsOptions,
	runMigrations,
} from "./runner.js";
